// Checks the cross-layer trace data: every reference resolves at the version it names, quoted statuses
// still appear where they are held, links agree with their basis, gaps contradict no link, and
// verification results appear only with a recorded run. Writes nothing.
//   npm run validate:trace [path/to/trace.json]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { machines, openQuestions, scenarios } from '../src/model';
import sources from '../src/model/generated/sources.json';
import { elementHash } from '../src/trace/hash';
import { parseRef, type ParsedRef } from '../src/trace/refs';
import { recordText } from './trace-text';
import type { Scenario } from '../src/model/scenarios';
import type { MachineDef } from '../src/model/types';
import type { Endpoint, Link, TraceData } from '../src/trace/types';
import { modelAt } from './pinned-model';
import { REPO_DIR, HANDOFFS, TRACE_FILE, WORKSPACE, repoCandidates } from './workspace';

const sourceRefs = (sources as { refs: Record<string, { note?: string }> }).refs;
const questionIds = new Set(openQuestions.map((q) => q.id));

export interface Result {
  errors: string[];
  warnings: string[];
  external: number;
}

// ---- local lookups (cached) -------------------------------------------------------------------------
const fileCache = new Map<string, string | null>();
function readWorkspace(rel: string): string | null {
  if (!fileCache.has(rel)) {
    const p = join(WORKSPACE, rel);
    fileCache.set(rel, existsSync(p) ? readFileSync(p, 'utf8') : null);
  }
  return fileCache.get(rel)!;
}
const gitCache = new Map<string, string | null>();
function gitShow(repoDir: string, sha: string, path: string): string | null {
  const key = `${repoDir}@${sha}:${path}`;
  if (!gitCache.has(key)) {
    try {
      gitCache.set(key, execFileSync('git', ['-C', repoDir, 'show', `${sha}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }));
    } catch {
      gitCache.set(key, null);
    }
  }
  return gitCache.get(key)!;
}
function commitExists(repoDir: string, sha: string): boolean {
  try {
    execFileSync('git', ['-C', repoDir, 'cat-file', '-e', `${sha}^{commit}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

type Resolution = { ok: true; text: string } | { ok: false; error: string } | { ok: 'external' } | { ok: 'unavailable'; warning: string };

/** Resolves a reference to the text of the record it names, at the version it names. */
/** The model model references resolve against: the pinned snapshot when one is given, else the current model. */
export interface RefModel {
  machines: Record<string, MachineDef>;
  scenarios: Scenario[];
}

export function resolveRef(ref: string, data: TraceData, model: RefModel = { machines, scenarios }): Resolution {
  const p = parseRef(ref);
  if (!p) return { ok: false, error: `unrecognised reference "${ref}"` };
  return resolveParsed(p, ref, data, model);
}

function resolveParsed(p: ParsedRef, ref: string, data: TraceData, model: RefModel): Resolution {
  switch (p.scheme) {
    case 'spec':
      return sourceRefs[p.id] || questionIds.has(p.id) ? { ok: true, text: sourceRefs[p.id]?.note ?? '' } : { ok: false, error: `${ref}: no such id in sources.json or open questions` };
    case 'model': {
      const m = model.machines[p.machine];
      if (!m) return { ok: false, error: `${ref}: no machine "${p.machine}"` };
      if (p.element && !m.states.some((s) => s.id === p.element) && !m.transitions.some((t) => t.id === p.element))
        return { ok: false, error: `${ref}: machine "${p.machine}" has no state or transition "${p.element}"` };
      return { ok: true, text: '' };
    }
    case 'model-scenario':
      return model.scenarios.some((s) => s.id === p.id) ? { ok: true, text: '' } : { ok: false, error: `${ref}: no model scenario ${p.id}` };
    case 'handoff': {
      const dir = `${HANDOFFS}/${p.slice}/${p.version}`;
      if (!existsSync(join(WORKSPACE, dir))) return { ok: false, error: `${ref}: handoff version folder ${dir}/ does not exist` };
      const text = ['HANDOFF.md', 'WORKFLOWS.md', 'SCREEN_SPEC.md', 'CHANGES.md']
        .map((f) => readWorkspace(`${dir}/${f}`))
        .filter((t): t is string => t !== null)
        .map((t) => recordText(t, p.id))
        .filter(Boolean)
        .join('\n');
      return text ? { ok: true, text } : { ok: false, error: `${ref}: ${p.id} is not a row or heading in ${dir}/` };
    }
    case 'design-map': {
      const file = `${HANDOFFS}/${p.slice}/design/${p.version}/DESIGN_MAP.md`;
      const md = readWorkspace(file);
      if (md === null) return { ok: false, error: `${ref}: ${file} does not exist` };
      const text = recordText(md, p.id);
      return text ? { ok: true, text } : { ok: false, error: `${ref}: ${p.id} has no row in ${file}` };
    }
    case 'figma': {
      const root = join(WORKSPACE, HANDOFFS);
      const hits: string[] = [];
      const needle = new RegExp(`${p.fileKey}/[^)]*node-id=${p.node}\\)`);
      for (const slice of existsSync(root) ? readdirSync(root) : []) {
        const designDir = join(root, slice, 'design');
        if (!existsSync(designDir)) continue;
        for (const v of readdirSync(designDir)) {
          const md = readWorkspace(`${HANDOFFS}/${slice}/design/${v}/DESIGN_MAP.md`);
          // a frame is listed either as a link, or by its bare id in a map whose Figma destination is that file
          // (a later design version may list carried frames by id only, e.g. "Result 58-1938")
          const bare = new RegExp(`(^|[^0-9-])${p.node}([^0-9-]|$)`);
          if (md) hits.push(...md.split('\n').filter((l) => needle.test(l) || (md.includes(p.fileKey) && bare.test(l))));
        }
      }
      return hits.length ? { ok: true, text: hits.join('\n') } : { ok: false, error: `${ref}: frame ${p.node} is not listed in any design map` };
    }
    case 'code':
    case 'test': {
      // another repository, looked for in the configured folders (loom.config.ts repoSearchDirs); a name can
      // exist in several, so the repository that holds the commit wins
      const candidates = repoCandidates(p.repo);
      const repoDir = candidates.find((d) => commitExists(d, p.sha)) ?? candidates[0];
      if (!repoDir) return { ok: 'unavailable', warning: `${ref}: repository ${p.repo} is not on this machine; not checked` };
      if (!commitExists(repoDir, p.sha)) return { ok: false, error: `${ref}: commit ${p.sha} not found in ${p.repo}` };
      const file = gitShow(repoDir, p.sha, p.path);
      if (file === null) return { ok: false, error: `${ref}: ${p.path} does not exist at ${p.sha}` };
      const lines = file.split('\n');
      if (p.scheme === 'code') {
        if (p.to > lines.length) return { ok: false, error: `${ref}: line ${p.to} is past the end of the file (${lines.length} lines) at ${p.sha}` };
        return { ok: true, text: lines.slice(p.from - 1, p.to).join('\n') };
      }
      const def = lines.find((l) => new RegExp(`\\b(def|fun|function)\\s+${p.name}\\s*\\(`).test(l));
      return def ? { ok: true, text: def } : { ok: false, error: `${ref}: no test named ${p.name} in ${p.path} at ${p.sha}` };
    }
    case 'notion':
      return { ok: 'external' };
    case 'finding':
      return data.findings.some((f) => f.id === p.id) ? { ok: true, text: '' } : { ok: false, error: `${ref}: no finding ${p.id}` };
    case 'work':
      return data.workItems.some((w) => w.id === p.id) ? { ok: true, text: '' } : { ok: false, error: `${ref}: no work item ${p.id}` };
  }
}

const ENUM = {
  linkType: ['refines', 'designs', 'allocates-to', 'evidences', 'covers', 'tests'],
  basis: ['stated', 'derived', 'interpretation'],
  layer: ['product', 'model', 'handoff', 'design', 'architecture', 'implementation', 'verification', 'research', 'work'],
  gapKind: ['checked-absent', 'out-of-scope'],
  statusKind: ['product-class', 'product-approval', 'design-coverage', 'design-acceptance', 'design-inspection', 'follow-up'],
  revSource: ['model', 'archive', 'notion', 'handoff', 'design', 'git', 'conversation'],
  runResult: ['pass', 'fail', 'inconclusive'],
  findingKind: ['unstated', 'missing-record', 'contradiction', 'interpretation-unconfirmed'],
  findingStatus: ['open', 'answered', 'withdrawn'],
  wiState: ['draft', 'approved-to-create', 'created', 'linked-existing'],
};

/** Which schemes each link type may connect. */
const ENDS: Record<Link['type'], [string[], string[]]> = {
  refines: [['handoff'], ['model']],
  designs: [['design-map', 'figma'], ['handoff']],
  'allocates-to': [['model'], ['spec']],
  evidences: [['code'], ['spec']],
  covers: [['handoff', 'model-scenario'], ['model']],
  tests: [['test'], ['code', 'handoff', 'model']],
};

/** True when a frame row's "carries" text names the id directly or within a range such as "IX-36 to IX-38". */
function mentions(text: string, id: string): boolean {
  if (new RegExp(`\\b${id}\\b`).test(text)) return true;
  const [prefix, num] = id.split('-');
  for (const m of text.matchAll(new RegExp(`${prefix}-(\\d+) to ${prefix}-(\\d+)`, 'g'))) if (+num >= +m[1] && +num <= +m[2]) return true;
  return false;
}

/**
 * Validates the trace against its pinned snapshot. `pinned` is the model at the trace's baseline commit:
 * model references must resolve there and recorded element hashes must equal the elements there. When the
 * pinned snapshot could not be loaded (null), that is an error: the current model is never substituted.
 * When it is not supplied (undefined), hashes are not validated and a warning says so. Differences between
 * the pin and the current model are the staleness report's business, not validation's.
 */
export function validateTrace(data: TraceData, opts: { checkBaselineDiff?: boolean; pinned?: RefModel | null } = {}): Result {
  const errors: string[] = [];
  const warnings: string[] = [];
  let external = 0;
  const err = (s: string) => errors.push(s);
  const pinned = opts.pinned ?? null;
  const refModel: RefModel = pinned ?? { machines, scenarios };
  const res = (ref: string, where: string): string | null => {
    const r = resolveRef(ref, data, refModel);
    if (r.ok === true) return r.text;
    if (r.ok === 'external') {
      external++;
      return '';
    }
    if (r.ok === 'unavailable') {
      warnings.push(`${where}: ${r.warning}`);
      return '';
    }
    err(`${where}: ${r.error}`);
    return null;
  };
  const uniq = (ids: string[], what: string, pattern: RegExp) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (!pattern.test(id)) err(`${what} id "${id}" does not match ${pattern}`);
      if (seen.has(id)) err(`duplicate ${what} id ${id}`);
      seen.add(id);
    }
  };
  const isDate = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s);

  if (data.version !== 1) err(`version must be 1`);

  // baseline and revisions
  const revIds = new Set(data.revisions.map((r) => r.id));
  uniq(data.revisions.map((r) => r.id), 'revision', /^rev-[a-z0-9-]+$/);
  for (const r of data.revisions) {
    if (!ENUM.revSource.includes(r.source)) err(`${r.id}: unknown source "${r.source}"`);
    if (!r.version) err(`${r.id}: version is empty`);
    if (!isDate(r.checkedAt)) err(`${r.id}: checkedAt must be a date`);
  }
  const commit = data.baseline?.modelCommit ?? '';
  if (!/^[0-9a-f]{40}$/.test(commit)) err(`baseline.modelCommit must be a full commit id`);
  else if (!commitExists(REPO_DIR, commit)) err(`baseline.modelCommit ${commit} is not a commit in this repository`);
  else if (opts.checkBaselineDiff !== false) {
    try {
      execFileSync('git', ['-C', REPO_DIR, 'diff', '--quiet', commit, '--', 'src/model'], { stdio: 'ignore' });
    } catch {
      warnings.push(`src/model differs from the pinned commit ${commit.slice(0, 7)}: validation uses the pinned snapshot; current differences are reported by \`npm run trace-staleness\``);
    }
  }
  if (opts.pinned === null) err(`the pinned snapshot (src/model at ${commit.slice(0, 7) || '?'}) could not be loaded: model references and recorded element hashes cannot be validated; the current model is not substituted`);
  else if (opts.pinned === undefined) warnings.push('no pinned snapshot supplied: model references were resolved against the current model and recorded element hashes were not validated');
  if (data.revisions.find((r) => r.id === 'rev-model-baseline')?.version !== commit) err(`rev-model-baseline must name the baseline commit`);
  const needRev = (rev: string | undefined, where: string) => {
    if (!rev || !revIds.has(rev)) err(`${where}: unknown revision "${rev}"`);
  };

  // status records
  for (const [i, rec] of data.records.entries()) {
    const where = `record ${rec.ref ?? i}`;
    needRev(rec.rev, where);
    const text = res(rec.ref, where);
    for (const ref of rec.appliesTo ?? []) res(ref, `${where} appliesTo`);
    if (!rec.statuses?.length) err(`${where}: no statuses`);
    for (const st of rec.statuses ?? []) {
      if (!ENUM.statusKind.includes(st.kind)) err(`${where}: unknown status kind "${st.kind}"`);
      if (!st.value || !st.heldIn) err(`${where}: status needs a value and where it is held`);
      if (st.checkIn === 'external') continue;
      if (!st.quote) {
        err(`${where}: a locally held status needs the exact quote that states it`);
        continue;
      }
      const hay = st.checkIn === 'row' ? text : readWorkspace(st.checkIn);
      if (hay === null && st.checkIn !== 'row') err(`${where}: ${st.checkIn} does not exist`);
      else if (hay !== null && !hay.includes(st.quote)) err(`${where}: status "${st.value}" no longer appears in ${st.checkIn === 'row' ? 'the referenced row' : st.checkIn} (quote: "${st.quote}")`);
    }
  }

  // links
  uniq(data.links.map((l) => l.id), 'link', /^L-\d{3}$/);
  const seenPairs = new Set<string>();
  let hashChecked = 0;
  const checkEnd = (e: Endpoint, where: string): string | null => {
    needRev(e.rev, where);
    const text = res(e.ref, where);
    const p = parseRef(e.ref);
    if (p?.scheme === 'model') {
      if (!e.elementHash || !/^sha256:[0-9a-f]{64}$/.test(e.elementHash)) err(`${where}: a model endpoint needs elementHash "sha256:<64 hex>"`);
      else if (pinned?.machines[p.machine]) {
        const atPin = elementHash(pinned.machines[p.machine], p.element);
        hashChecked++;
        if (atPin && atPin !== e.elementHash) err(`${where}: recorded elementHash does not match ${e.ref} in the pinned snapshot ${commit.slice(0, 7)} (recorded ${e.elementHash.slice(0, 19)}…, pinned ${atPin.slice(0, 19)}…)`);
      }
    } else if (e.elementHash) err(`${where}: only model endpoints carry an elementHash`);
    return text;
  };
  for (const l of data.links) {
    const where = `link ${l.id}`;
    if (!ENUM.linkType.includes(l.type)) err(`${where}: unknown type "${l.type}"`);
    if (!ENUM.basis.includes(l.basis))
      err(`${where}: basis "${l.basis}" is not allowed${(l.basis as string) === 'missing' ? ': record an absence as a coverage gap, not a link' : ''}`);
    const fromText = checkEnd(l.from, `${where} from`);
    checkEnd(l.to, `${where} to`);
    const fp = parseRef(l.from.ref);
    const tp = parseRef(l.to.ref);
    const ends = ENDS[l.type];
    if (ends && fp && tp && (!ends[0].includes(fp.scheme) || !ends[1].includes(tp.scheme)))
      err(`${where}: ${l.type} cannot connect ${fp.scheme} → ${tp.scheme}`);
    const pair = `${l.type}|${l.from.ref}|${l.to.ref}`;
    if (seenPairs.has(pair)) err(`${where}: duplicate of an earlier ${l.type} link`);
    seenPairs.add(pair);
    if (l.basis === 'stated' && fromText !== null && fp && tp) {
      if ((l.type === 'refines' || l.type === 'covers') && tp.scheme === 'model' && tp.element && fp.scheme === 'handoff' && !new RegExp(`\\b${tp.element}\\b`).test(fromText))
        err(`${where}: stated, but ${l.from.ref} does not mention ${tp.element}`);
      if (l.type === 'designs' && tp.scheme === 'handoff') {
        if (fp.scheme === 'design-map' && (fp.id !== tp.id || fp.version !== tp.version)) err(`${where}: a design-map row designs the requirement of the same id and version`);
        if (fp.scheme === 'figma' && !mentions(fromText, tp.id)) err(`${where}: stated, but frame ${fp.node}'s row does not carry ${tp.id}`);
      }
    }
    if (l.basis === 'derived') {
      if (!l.sharedRefs?.length) err(`${where}: a derived link must give the sharedRefs it rests on`);
      if (l.type === 'allocates-to' && fp?.scheme === 'model' && tp?.scheme === 'spec') {
        const m = machines[fp.machine];
        const el = fp.element ? [...m.states, ...m.transitions].find((x) => x.id === fp.element) : m;
        const elRefs = new Set(el?.refs ?? []);
        const afNote = sourceRefs[tp.id]?.note ?? '';
        for (const r of l.sharedRefs ?? []) {
          if (!elRefs.has(r)) err(`${where}: ${l.from.ref} does not cite ${r}`);
          if (!new RegExp(`\\b${r}\\b`).test(afNote)) err(`${where}: ${tp.id} does not cite ${r}`);
        }
      }
    }
    if (l.basis === 'interpretation' && !l.note) err(`${where}: an interpretation needs a note saying what was read`);
  }
  void hashChecked;

  // coverage gaps
  uniq(data.gaps.map((g) => g.id), 'gap', /^G-\d{2}$/);
  for (const g of data.gaps) {
    const where = `gap ${g.id}`;
    for (const k of ['to', 'target', 'from', 'elementHash', 'rev'])
      if (k in (g as object)) err(`${where}: a coverage gap has no "${k}": nothing is invented for what does not exist`);
    res(g.anchor, `${where} anchor`);
    if (!ENUM.gapKind.includes(g.kind)) err(`${where}: kind must be checked-absent or out-of-scope ("no link recorded" is shown, not stored)`);
    if (!ENUM.layer.includes(g.expected?.layer)) err(`${where}: unknown expected layer "${g.expected?.layer}"`);
    if (!g.reason?.trim()) err(`${where}: reason is empty`);
    if (g.kind === 'checked-absent') {
      if (!g.checked?.source) err(`${where}: checked-absent must name the source that was checked`);
      needRev(g.checked?.rev, `${where} checked`);
      // a checked absence must not be contradicted by a recorded link or a model scenario
      const contradicting = data.links.filter(
        (l) =>
          l.type === g.expected.relationship &&
          (l.from.ref === g.anchor || l.to.ref === g.anchor) &&
          (!g.expected.endpoint || parseRef(l.from.ref === g.anchor ? l.to.ref : l.from.ref)?.scheme === g.expected.endpoint),
      );
      if (contradicting.length) err(`${where}: says no ${g.expected.relationship} exists, but ${contradicting.map((l) => l.id).join(', ')} record one`);
      const ap = parseRef(g.anchor);
      if (g.expected.relationship === 'covers' && ap?.scheme === 'model' && ap.element) {
        const steps = refModel.scenarios.filter((s) => s.steps.some((st) => st.machine === ap.machine && st.element === ap.element)).map((s) => s.id);
        if (steps.length) err(`${where}: says no scenario covers ${g.anchor}, but ${steps.join(', ')} step through it`);
      }
    }
  }

  // verification: definitions and runs
  for (const s of data.scenarios) {
    needRev(s.rev, `scenario ${s.ref}`);
    res(s.ref, `scenario ${s.ref}`);
    if (parseRef(s.ref)?.scheme !== 'handoff' || !/#SCN-/.test(s.ref)) err(`scenario ${s.ref}: must be a handoff SCN reference (model scenarios come from the model)`);
  }
  for (const t of data.tests) {
    needRev(t.rev, `test ${t.ref}`);
    res(t.ref, `test ${t.ref}`);
    if (parseRef(t.ref)?.scheme !== 'test') err(`test ${t.ref}: must be a test reference`);
  }
  const defs = new Set([...data.tests.map((t) => t.ref), ...data.scenarios.map((s) => s.ref)]);
  uniq(data.runs.map((r) => r.id), 'run', /^RUN-\d{2}$/);
  for (const r of data.runs) {
    const where = `run ${r.id}`;
    if (!defs.has(r.of)) err(`${where}: "${r.of}" is not a recorded test or scenario definition`);
    if (!r.revisions?.length) err(`${where}: a run must name the revisions it checked`);
    for (const rev of r.revisions ?? []) needRev(rev, where);
    if (!ENUM.runResult.includes(r.result)) err(`${where}: result must be pass, fail or inconclusive`);
    if (!isDate(r.ranAt)) err(`${where}: ranAt must be a date`);
    if (!r.by) err(`${where}: who ran it is required`);
  }

  // findings and work items
  uniq(data.findings.map((f) => f.id), 'finding', /^XLF-\d{2}$/);
  for (const f of data.findings) {
    const where = `finding ${f.id}`;
    if (!f.targets?.length) err(`${where}: needs at least one target`);
    for (const t of f.targets ?? []) res(t, `${where} target`);
    const cp = parseRef(f.component);
    if (cp?.scheme !== 'model' || cp.element) err(`${where}: component must be a whole model machine`);
    else {
      res(f.component, `${where} component`);
      for (const t of f.targets ?? []) {
        const tp = parseRef(t);
        if (tp?.scheme === 'model' && tp.machine !== cp.machine) err(`${where}: target ${t} is not in component ${f.component}`);
      }
    }
    for (const s of f.scenarios ?? []) res(s, `${where} scenario`);
    for (const rev of f.at ?? []) needRev(rev, where);
    if (!f.at?.length) err(`${where}: must name the revisions it was made against`);
    if (!ENUM.findingKind.includes(f.kind)) err(`${where}: unknown kind "${f.kind}"`);
    if (!ENUM.findingStatus.includes(f.status)) err(`${where}: unknown status "${f.status}"`);
    for (const a of f.answeredBy ?? []) res(a, `${where} answeredBy`);
    if (f.status === 'answered' && !f.answeredBy?.length) err(`${where}: an answered finding must name the decisions that answer it`);
    if (f.status !== 'answered' && f.answeredBy?.length) err(`${where}: answeredBy is only for an answered finding`);
    if (!f.what?.trim() || !f.consequence?.trim()) err(`${where}: what and consequence are required`);
  }
  uniq(data.workItems.map((w) => w.id), 'work item', /^WI-\d{2}$/);
  const keys = new Map<string, string>();
  for (const w of data.workItems) {
    const where = `work item ${w.id}`;
    if (!w.findings?.length) err(`${where}: must track at least one finding`);
    for (const id of w.findings ?? []) if (!data.findings.some((f) => f.id === id)) err(`${where}: no finding ${id}`);
    if (!ENUM.wiState.includes(w.state)) err(`${where}: unknown state "${w.state}"`);
    if (!w.system?.trim()) err(`${where}: system (the tracker the item is meant for) is required`);
    if ((w.state === 'created' || w.state === 'linked-existing') && !w.key) err(`${where}: ${w.state} needs the issue key`);
    if ((w.state === 'draft' || w.state === 'approved-to-create') && w.key) err(`${where}: a ${w.state} work item has no issue key yet`);
    if (!w.dedupeKey) err(`${where}: dedupeKey is required`);
    else if (keys.has(w.dedupeKey)) err(`${where}: same dedupeKey as ${keys.get(w.dedupeKey)}`);
    else keys.set(w.dedupeKey, w.id);
    if (!w.title?.trim() || !w.body?.trim()) err(`${where}: title and body are required`);
  }

  return { errors, warnings, external };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = resolve(process.argv[2] ?? join(REPO_DIR, TRACE_FILE));
  const data = JSON.parse(readFileSync(file, 'utf8')) as TraceData;
  const pinned = /^[0-9a-f]{40}$/.test(data.baseline?.modelCommit ?? '') ? await modelAt(REPO_DIR, data.baseline.modelCommit) : null;
  const r = validateTrace(data, { pinned });
  if (pinned) console.log(`validated against the pinned snapshot: src/model at ${data.baseline.modelCommit.slice(0, 7)}`);
  for (const w of r.warnings) console.log(`warning: ${w}`);
  for (const e of r.errors) console.log(`error: ${e}`);
  console.log(
    `trace: revisions ${data.revisions.length}  records ${data.records.length}  links ${data.links.length}  gaps ${data.gaps.length}  scenario defs ${data.scenarios.length}  test defs ${data.tests.length}  runs ${data.runs.length}  findings ${data.findings.length}  work items ${data.workItems.length}  (external, not checked offline: ${r.external})`,
  );
  console.log(r.errors.length ? `FAILED (${r.errors.length} error(s), ${r.warnings.length} warning(s))` : `OK (${r.warnings.length} warning(s))`);
  process.exit(r.errors.length ? 1 : 0);
}
