// Read-only queries over the trace data for the viewer. Nothing here computes a status: statuses are
// passed through from the records that hold them.
import { loomConfig } from '../../loom.config';
import { machines, scenarios } from '../model';
import { elementHash } from './hash';
import { parseRef } from './refs';
import type { CheckRun, CoverageGap, Finding, Link, StatusRecord, TraceData, TraceRef, WorkItem } from './types';

// The trace named in loom.config.ts (it must sit in trace/). A model with no trace yet still renders: every
// element then reads "Not traced yet".
const traceFiles = import.meta.glob('../../trace/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const EMPTY: TraceData = { version: 1, scope: '', status: 'No trace file was found when the viewer was built.', baseline: { modelCommit: '' }, revisions: [], records: [], links: [], gaps: [], scenarios: [], tests: [], runs: [], findings: [], workItems: [] };
export const trace = (traceFiles[`../../${loomConfig.traceFile}`] ?? EMPTY) as TraceData;
export * from './types';
export { hrefOf, layerOf, parseRef, shortLabel } from './refs';

const recordByRef = new Map(trace.records.map((r) => [r.ref, r]));
export const recordOf = (ref: TraceRef): StatusRecord | undefined => recordByRef.get(ref);
export const revisionOf = (id: string) => trace.revisions.find((r) => r.id === id);
export const modelRef = (machine: string, element?: string) => `model:${machine}${element ? '/' + element : ''}`;

export interface ScenarioUse {
  ref: TraceRef;
  title: string;
  source: 'model' | 'handoff';
  steps?: number[];
  link?: Link;
}
export interface Related<T> {
  item: T;
  via?: TraceRef; // the reference through which it was reached
}
export interface TraceView {
  ref: TraceRef;
  component: string; // machine id the selection belongs to
  hash: { now: string | null; recorded: string | null };
  approvals: StatusRecord[];
  approvalsVia?: string; // machine id when they apply through a used component
  refines: Link[];
  designs: Related<Link>[];
  allocates: Link[];
  evidence: Related<Link>[];
  scenarioDefs: ScenarioUse[];
  testDefs: Related<Link>[];
  runs: CheckRun[];
  gaps: Related<CoverageGap>[];
  componentGaps: CoverageGap[];
  componentGapsVia?: string; // machine id the component gaps are anchored on
  direct: Finding[];
  related: Finding[];
  relatedVia?: string;
  workItems: WorkItem[];
  hasAny: boolean;
}

/** Everything the trace holds for one selection. `uses` is the machine a composite state stands for. */
export function traceFor(machineId: string, elementId?: string, uses?: string): TraceView {
  const ref = modelRef(machineId, elementId);
  const componentRef = modelRef(machineId);
  const m = machines[machineId];
  const touching = trace.links.filter((l) => l.from.ref === ref || l.to.ref === ref);
  const refines = touching.filter((l) => l.type === 'refines');
  const allocates = touching.filter((l) => l.type === 'allocates-to');

  // one hop out: designs of the requirements that refine this element; evidence and tests on its follow-ups
  const reqRefs = [...new Set(refines.map((l) => l.from.ref))];
  const designs = reqRefs.flatMap((r) => trace.links.filter((l) => l.type === 'designs' && l.to.ref === r).map((item) => ({ item, via: r })));
  const afRefs = [...new Set(allocates.map((l) => l.to.ref))];
  const evidence = afRefs.flatMap((r) => trace.links.filter((l) => l.type === 'evidences' && l.to.ref === r).map((item) => ({ item, via: r })));
  const codeRefs = new Set(evidence.map((e) => e.item.from.ref));
  const testDefs = trace.links.filter((l) => l.type === 'tests' && codeRefs.has(l.to.ref)).map((item) => ({ item, via: item.to.ref }));

  const scenarioDefs: ScenarioUse[] = [];
  if (elementId)
    for (const s of scenarios) {
      const steps = s.steps.map((st, i) => (st.machine === machineId && st.element === elementId ? i + 1 : 0)).filter(Boolean);
      if (steps.length) scenarioDefs.push({ ref: `model-scenario:${s.id}`, title: s.title, source: 'model', steps });
    }
  for (const l of touching.filter((x) => x.type === 'covers'))
    scenarioDefs.push({ ref: l.from.ref, title: trace.scenarios.find((s) => s.ref === l.from.ref)?.title ?? l.from.ref, source: 'handoff', link: l });
  const defRefs = new Set([...scenarioDefs.map((s) => s.ref), ...testDefs.map((t) => t.item.from.ref)]);
  const runs = trace.runs.filter((r) => defRefs.has(r.of));

  const gaps: Related<CoverageGap>[] = [
    ...trace.gaps.filter((g) => g.anchor === ref && ref !== componentRef).map((item) => ({ item })),
    ...reqRefs.flatMap((r) => trace.gaps.filter((g) => g.anchor === r).map((item) => ({ item, via: r }))),
  ];
  const ownComponentGaps = trace.gaps.filter((g) => g.anchor === componentRef);

  // findings: directly on this selection, or related through the component it belongs to or stands for
  const direct = trace.findings.filter((f) => f.targets.includes(ref));
  const throughOwn = trace.findings.filter((f) => f.component === componentRef && !direct.includes(f));
  const throughUsed = uses ? trace.findings.filter((f) => f.component === modelRef(uses) && !direct.includes(f)) : [];
  const related = throughOwn.length ? throughOwn : throughUsed;
  const relatedVia = throughOwn.length ? machineId : throughUsed.length ? uses : undefined;

  const ownApprovals = trace.records.filter((r) => r.appliesTo?.includes(componentRef));
  const usedApprovals = uses ? trace.records.filter((r) => r.appliesTo?.includes(modelRef(uses))) : [];
  const approvals = ownApprovals.length ? ownApprovals : usedApprovals;
  const approvalsVia = !ownApprovals.length && usedApprovals.length ? uses : undefined;
  const usedComponentGaps = uses ? trace.gaps.filter((g) => g.anchor === modelRef(uses)) : [];
  const componentGaps = ownComponentGaps.length ? ownComponentGaps : usedComponentGaps;
  const componentGapsVia = ownComponentGaps.length ? machineId : usedComponentGaps.length ? uses : undefined;

  const shownFindings = new Set([...direct, ...related].map((f) => f.id));
  const workItems = trace.workItems.filter((w) => w.findings.some((id) => shownFindings.has(id)));

  const recorded = [...touching.map((l) => (l.from.ref === ref ? l.from : l.to))].find((e) => e.elementHash)?.elementHash ?? null;
  const hasAny = !!(touching.length || direct.length || related.length || approvals.length || componentGaps.length || gaps.length || scenarioDefs.length);

  return {
    ref,
    component: machineId,
    hash: { now: m ? elementHash(m, elementId) : null, recorded },
    approvals,
    approvalsVia,
    refines,
    designs,
    allocates,
    evidence,
    scenarioDefs,
    testDefs,
    runs,
    gaps,
    componentGaps,
    componentGapsVia,
    direct,
    related,
    relatedVia,
    workItems,
    hasAny,
  };
}

/** The text a person would paste into an issue tracker. Copying it sends nothing anywhere. */
export const workItemText = (w: WorkItem) => `${w.title}\n\n${w.body}\n`;

/** True when a reference is a finding target that belongs to another layer than the model (shown by id). */
export const isModelRef = (ref: TraceRef) => parseRef(ref)?.scheme === 'model';
