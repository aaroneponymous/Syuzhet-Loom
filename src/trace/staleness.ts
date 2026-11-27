// The staleness report, as the viewer reads it. The report is generated output (npm run trace-staleness)
// and may be absent; it is bundled at build time as raw text when present and parsed here, so a missing or
// invalid report never breaks the viewer. Read-only: nothing here changes the trace or the report.
import { loomConfig } from '../../loom.config';
import { machineList } from '../model';
import { modelFingerprint, sha256Hex } from './hash';
import { trace, traceFor, type TraceView } from './index';
import { parseRef } from './refs';

export interface ReportRef {
  ref: string;
  scheme: string;
  integrity: { status: 'matches' | 'differs' | 'unresolved' | 'unavailable'; precision: string; detail: string };
  later: {
    status: 'no-later' | 'later-unchanged' | 'changed' | 'removed' | 'unmatched' | 'inconclusive' | 'not-versioned' | 'unavailable';
    pinned: string;
    latest: string;
    basedOn?: string;
    firstChangedIn?: string;
    provisional?: string;
    detail: string;
  };
  dependencies?: { checked: { dependency: string; status: string; detail?: string }[]; unchecked: string[] };
}
export interface ReportAffected {
  subject: 'link' | 'finding' | 'work-item' | 'gap' | 'record';
  id: string;
  label: string;
  summary: string;
  reasons: { ref: string; kind: string; path: string }[];
}
export interface Report {
  generatedAt: string;
  status: string;
  fingerprints: { traceData: string; model: string; baselineCommit: string };
  scope: string[];
  inspection: { snapshotId?: string; stable: boolean; changedDuringScan: string[] };
  refs: ReportRef[];
  affected: ReportAffected[];
  externalFacts: { ref: string; fact: string; checkedAt: string; note: string }[];
}
export type ReportState = { state: 'missing' } | { state: 'invalid'; error: string } | { state: 'loaded'; report: Report; outdated: string[] };

const traceRaws = import.meta.glob('../../trace/*.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const traceRaw = traceRaws[`../../${loomConfig.traceFile}`] ?? '';
// the report folder is loom.config.ts reportDir; a glob pattern has to be written out here
const bundled = import.meta.glob('../../trace-reports/staleness.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

/** Parses report text and checks it was made from the trace and model this viewer was built with. */
export function loadReport(raw: string | undefined, current = { traceData: `sha256:${sha256Hex(traceRaw)}`, model: modelFingerprint(machineList), baseline: trace.baseline.modelCommit }): ReportState {
  if (raw === undefined) return { state: 'missing' };
  let r: Report;
  try {
    r = JSON.parse(raw);
  } catch (e) {
    return { state: 'invalid', error: `not valid JSON (${(e as Error).message})` };
  }
  const shapeOk =
    r && typeof r === 'object' && typeof r.generatedAt === 'string' && Array.isArray(r.refs) && Array.isArray(r.affected) && Array.isArray(r.scope) && r.fingerprints && typeof r.fingerprints.traceData === 'string' && r.inspection && typeof r.inspection.stable === 'boolean';
  if (!shapeOk) return { state: 'invalid', error: 'unexpected structure: not a staleness report' };
  const outdated: string[] = [];
  if (r.fingerprints.traceData !== current.traceData) outdated.push(`the trace data (${loomConfig.traceFile}) changed after the report was generated`);
  if (r.fingerprints.model !== current.model) outdated.push('the model changed after the report was generated');
  if (r.fingerprints.baselineCommit !== current.baseline) outdated.push('the trace now names a different baseline commit');
  return { state: 'loaded', report: r, outdated };
}

export const reportState: ReportState = loadReport(Object.values(bundled)[0]);

export type Verdict = 'needs-review' | 'incomplete' | 'no-change' | 'no-coverage';
export interface RefLine {
  ref: string;
  entry?: ReportRef;
  flagged: boolean;
  outOfScope: boolean; // a source the report does not read (an external service such as Notion)
}
export interface ElementStaleness {
  verdict: Verdict;
  pinned: RefLine[];
  review: ReportAffected[];
  related: ReportAffected[];
  relatedVia?: string;
  notInScope: RefLine[];
}

/** The staleness of one selection, from the report alone. An unchanged element hash is never a verdict on its own. */
export function stalenessFor(report: Report, view: TraceView, machineId: string, elementId?: string, uses?: string): ElementStaleness {
  const byRef = new Map(report.refs.map((r) => [r.ref, r]));
  const flaggedRefs = new Set(report.affected.flatMap((a) => a.reasons.map((x) => x.ref)));
  const affectedOf = (subject: ReportAffected['subject'], id: string) => report.affected.find((a) => a.subject === subject && a.id === id);

  // references this selection depends on directly: itself, its links' other ends, one hop to design and evidence
  const refs = new Set<string>();
  if (elementId) refs.add(view.ref);
  for (const l of view.refines) refs.add(l.from.ref);
  for (const d of view.designs) refs.add(d.item.from.ref);
  for (const l of view.allocates) refs.add(l.to.ref);
  for (const e of view.evidence) refs.add(e.item.from.ref);
  for (const t of view.testDefs) refs.add(t.item.from.ref);
  for (const s of view.scenarioDefs) if (s.source === 'handoff') refs.add(s.ref);
  for (const a of view.approvals) refs.add(a.ref);
  const lines: RefLine[] = [...refs].sort().map((ref) => ({ ref, entry: byRef.get(ref), flagged: flaggedRefs.has(ref), outOfScope: parseRef(ref)?.scheme === 'notion' }));

  // links touching the selection, and one hop out, as the trace section shows them
  const linkIds = new Set([...view.refines, ...view.allocates, ...view.designs.map((d) => d.item), ...view.evidence.map((e) => e.item), ...view.testDefs.map((t) => t.item)].map((l) => l.id));
  for (const s of view.scenarioDefs) if (s.link) linkIds.add(s.link.id);
  const review: ReportAffected[] = [
    ...[...linkIds].sort().flatMap((id) => affectedOf('link', id) ?? []),
    ...view.direct.flatMap((f) => affectedOf('finding', f.id) ?? []),
    ...view.workItems.filter((w) => w.findings.some((f) => view.direct.some((d) => d.id === f))).flatMap((w) => affectedOf('work-item', w.id) ?? []),
    ...view.gaps.flatMap((g) => affectedOf('gap', g.item.id) ?? []),
    ...[...refs].flatMap((r) => affectedOf('record', r) ?? []),
  ];
  const related: ReportAffected[] = [
    ...view.related.flatMap((f) => affectedOf('finding', f.id) ?? []),
    ...view.workItems.filter((w) => !w.findings.some((f) => view.direct.some((d) => d.id === f))).flatMap((w) => affectedOf('work-item', w.id) ?? []),
    ...view.componentGaps.flatMap((g) => affectedOf('gap', g.id) ?? []),
  ];

  const inScope = lines.filter((l) => !l.outOfScope);
  const covered = inScope.some((l) => l.entry) || review.length > 0;
  let verdict: Verdict;
  if (!covered) verdict = 'no-coverage';
  else if (review.length || inScope.some((l) => l.flagged)) verdict = 'needs-review';
  else if (inScope.some((l) => l.entry && (['unavailable', 'inconclusive'].includes(l.entry.integrity.status) || ['unavailable', 'inconclusive'].includes(l.entry.later.status) || !!l.entry.later.provisional)) || inScope.some((l) => !l.entry))
    verdict = 'incomplete';
  else verdict = 'no-change';
  return { verdict, pinned: inScope, review, related, relatedVia: view.relatedVia ?? (uses && view.related.length ? uses : undefined), notInScope: lines.filter((l) => l.outOfScope) };
}

/** Short sentences for one reference, e.g. "Pinned v2 reference matches. Changed in inspected v4. Needs review." */
export function pinnedSentence(e: ReportRef): string {
  const p = e.later.pinned;
  switch (e.integrity.status) {
    case 'matches':
      return e.integrity.precision === 'none' ? `Pinned ${p} reference resolves (no recorded content to compare).` : `Pinned ${p} reference matches.`;
    case 'differs':
      return e.integrity.precision === 'file' ? `Pinned ${p} file differs from what was recorded; effect on this item unknown.` : `Pinned ${p} reference differs from what was recorded.`;
    case 'unresolved':
      return `Pinned ${p} reference cannot be resolved.`;
    default:
      return 'Cannot check: source unavailable.';
  }
}

export function laterSentence(e: ReportRef): string {
  const l = e.later;
  const at = l.basedOn ? `complete ${l.basedOn}` : `inspected ${l.latest}`;
  const first = l.firstChangedIn && l.firstChangedIn !== (l.basedOn ?? l.latest) ? ` (first in ${l.firstChangedIn})` : '';
  const prov = l.provisional ? ` ${l.basedOn ? `${l.latest} was inspected but is an incomplete draft; what it shows is provisional.` : 'Provisional: the newer version is an incomplete draft.'}` : '';
  switch (l.status) {
    case 'no-later':
      return `No later version found within the inspected sources.`;
    case 'later-unchanged':
      return `Unchanged in ${at}.${prov}`;
    case 'changed':
      return `Changed in ${at}${first}.${prov}`;
    case 'removed':
      return `Not found in ${at}.${prov}`;
    case 'unmatched':
      return `Cannot be matched reliably in ${at}.${prov}`;
    case 'inconclusive':
      return `Inconclusive in ${at}: ${l.detail.split(';')[0]}.`;
    case 'not-versioned':
      return 'Not versioned by folder; compared as the archive copy.';
    default:
      return 'Cannot check later versions: source unavailable.';
  }
}

export { traceFor };
