// Staleness of the trace: whether each pinned reference still matches what was recorded, whether later
// versions of it exist and differ, and which links, findings, work items, gaps and records may need review.
// Pure: every source is read through a World, so fixtures can stand in for the real files and repositories.
// It changes nothing. A flag means "needs review", never "wrong".
import { createHash } from 'node:crypto';
import type { MachineDef, OpenQuestion } from '../src/model/types';
import type { Scenario } from '../src/model/scenarios';
import { canonicalJson, elementHash, modelFingerprint } from '../src/trace/hash';
import { parseRef, type ParsedRef } from '../src/trace/refs';
import type { Revision, TraceData } from '../src/trace/types';
import { recordText } from './trace-text';
import { loomConfig } from '../loom.config';

// Workspace-relative folder names (loom.config.ts). Every path a World is asked for starts with one of them.
const HANDOFFS = loomConfig.handoffsDir;
const SPEC = loomConfig.specDir;

// ---- inputs -------------------------------------------------------------------------------------------
export interface ModelSnapshot {
  machines: Record<string, MachineDef>;
  scenarios: Scenario[];
  questions: OpenQuestion[];
}
export interface RepoView {
  head: string;
  commitExists(sha: string): boolean;
  show(sha: string, path: string): string | null;
  /** Object id of the file at a commit, or null. */
  blob(sha: string, path: string): string | null;
  /** Uncommitted changes to the path in the working tree. */
  dirty(path: string): boolean;
}
export interface World {
  now: string;
  /** When the scan started (ms since epoch); versions modified shortly before it count as possibly being written. */
  scanStartedMs: number;
  /** Workspace-relative file, or null when absent. */
  readFile(rel: string): string | null;
  /** Workspace-relative directory entries, or null when absent. */
  listDir(rel: string): string[] | null;
  /** Modification time of a workspace-relative path, or null. */
  stat(rel: string): { mtimeMs: number } | null;
  /** Archive files and the SHA-256 recorded for each in SOURCE_VERSIONS.md at the trace's baseline commit (workspace-relative paths). */
  archiveRecorded: Record<string, string>;
  /** Model at the baseline commit, or null when it could not be loaded. */
  baseline: ModelSnapshot | null;
  /** Model in the working tree. */
  current: ModelSnapshot;
  repo: { baseline: string; head: string | null; modelDirty: boolean | null };
  /** Bundled original wording of each spec id, as extracted at the baseline. */
  specText(id: string): string | undefined;
  /**
   * The same id's wording extracted from the archive as it is now, or null when the current extraction is
   * not known to match the current archive (then the baseline wording is searched for verbatim instead).
   */
  currentSpecText: ((id: string) => string | undefined) | null;
  /** Other repositories named in code: and test: references, by name; null when not on this machine. */
  repos: Record<string, RepoView | null>;
}

/**
 * How recently a version must have been edited to be reported as "recently edited". This is information
 * only: it never decides whether a version is complete. Completeness comes from the version's content
 * (versionInfo); a file changing while it is read is caught by the snapshot recheck.
 */
export const RECENT_EDIT_MS = 15 * 60 * 1000;

/** Files the handoff contract requires in each version folder (docs/TRACE.md, "Handoff folders"). */
export const REQUIRED_FILES: Record<'handoff' | 'design', (n: number) => string[]> = {
  handoff: (n) => ['HANDOFF.md', 'WORKFLOWS.md', 'SCREEN_SPEC.md', ...(n >= 2 ? ['CHANGES.md'] : [])],
  design: () => ['DESIGN_MAP.md', 'FINDINGS.md'],
};

// ---- outputs ------------------------------------------------------------------------------------------
export type IntegrityStatus = 'matches' | 'differs' | 'unresolved' | 'unavailable';
export type Precision = 'item' | 'file' | 'commit' | 'none';
export interface Integrity {
  status: IntegrityStatus;
  precision: Precision;
  detail: string;
}
export type LaterStatus = 'no-later' | 'later-unchanged' | 'changed' | 'removed' | 'unmatched' | 'inconclusive' | 'not-versioned' | 'unavailable';
export interface Diff {
  removed: string[];
  added: string[];
}
export interface VersionStep {
  version: string;
  status: 'unchanged' | 'changed' | 'replaced' | 'removed' | 'inconclusive';
  complete: boolean;
  declared?: string[]; // rows naming the id in that version's CHANGES.md
  note?: string;
}
export interface CellComparison {
  layoutOnly: boolean;
  changed: { column: string; from: string; to: string }[];
  addedColumns: { column: string; value: string }[];
  removedColumns: { column: string; value: string }[];
}
export interface Later {
  status: LaterStatus;
  precision: Precision;
  pinned: string;
  /** The newest version inspected. */
  latest: string;
  /** The newest complete version the status is based on, when it differs from `latest`. */
  basedOn?: string;
  steps: VersionStep[];
  firstChangedIn?: string;
  diff?: Diff;
  cells?: CellComparison;
  /** What an incomplete newer version shows, kept apart from the status. */
  provisional?: string;
  detail: string;
}
export interface DependencyCheck {
  dependency: string;
  status: 'unchanged' | 'changed' | 'removed' | 'unavailable';
  detail?: string;
}
export interface RefReport {
  ref: string;
  scheme: string;
  rev?: string;
  integrity: Integrity;
  later: Later;
  dependencies?: { checked: DependencyCheck[]; unchecked: string[] };
  usedBy: string[];
  /** Workspace files and directories read to produce this entry. */
  files: string[];
}
export interface Reason {
  ref: string;
  kind: 'pinned-differs' | 'pinned-unresolved' | 'later-changed' | 'later-removed' | 'later-unmatched' | 'dependency-changed';
  path: string;
}
export interface Affected {
  subject: 'link' | 'finding' | 'work-item' | 'gap' | 'record';
  id: string;
  label: 'needs review';
  summary: string;
  reasons: Reason[];
}
export interface InspectedFile {
  path: string;
  sha256: string | null;
  mtime: string | null;
}
export interface VersionInfo {
  source: string;
  version: string;
  files: string[];
  /** Draft completeness, judged from content only: required files present, nothing its predecessor had is missing, no empty file, and its header names this version. */
  complete: boolean;
  /** Why it is not complete; empty when complete. */
  reasons: string[];
  /** Time since the last edit, reported separately from completeness. */
  lastEdited: string | null;
  recentlyEdited: boolean;
}
export interface StalenessReport {
  generatedAt: string;
  tool: string;
  status: string;
  fingerprints: { traceData: string; model: string; baselineCommit: string };
  baseline: World['repo'];
  scope: string[];
  sources: { source: string; pinned: string; latest: string; note: string }[];
  versions: VersionInfo[];
  inspection: { snapshotId: string; files: InspectedFile[]; stable: boolean; changedDuringScan: string[]; attempts: number };
  refs: RefReport[];
  affected: Affected[];
  externalFacts: { ref: string; fact: string; checkedAt: string; note: string }[];
  incomplete: string[];
  summary: Record<string, number>;
}

// ---- helpers ------------------------------------------------------------------------------------------
export const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const vnum = (v: string) => Number(v.replace(/^v/, ''));
const short = (sha: string) => sha.slice(0, 7);

/** Word-level difference between two texts (longest common subsequence). */
export function wordDiff(a: string, b: string): Diff {
  const x = a.split(/\s+/).filter(Boolean);
  const y = b.split(/\s+/).filter(Boolean);
  const n = x.length;
  const m = y.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const removed: string[] = [];
  const added: string[] = [];
  let i = 0;
  let j = 0;
  let r: string[] = [];
  let ad: string[] = [];
  const flush = () => {
    if (r.length) removed.push(r.join(' '));
    if (ad.length) added.push(ad.join(' '));
    r = [];
    ad = [];
  };
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) {
      flush();
      i++;
      j++;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) ad.push(y[j++]);
    else r.push(x[i++]);
  }
  flush();
  return { removed, added };
}

/** The file a handoff or design item is compared in: the item's defining file, not the change log. */
function itemFile(p: ParsedRef): string | null {
  if (p.scheme === 'handoff') return /^SCN-/.test(p.id) ? 'WORKFLOWS.md' : 'SCREEN_SPEC.md';
  if (p.scheme === 'design-map' || p.scheme === 'figma') return 'DESIGN_MAP.md';
  return null;
}
const versionDir = (slice: string, kind: 'handoff' | 'design', v: string) => (kind === 'handoff' ? `${HANDOFFS}/${slice}/${v}` : `${HANDOFFS}/${slice}/design/${v}`);

function versions(w: World, slice: string, kind: 'handoff' | 'design'): string[] {
  const dir = kind === 'handoff' ? `${HANDOFFS}/${slice}` : `${HANDOFFS}/${slice}/design`;
  return (w.listDir(dir) ?? []).filter((d) => /^v\d+$/.test(d)).sort((a, b) => vnum(a) - vnum(b));
}

/**
 * Whether each version folder is a complete draft, judged from its content alone: it holds the files the
 * handoff contract requires and every Markdown file its predecessor held, none of them is empty, and its
 * header names this version (HANDOFF.md "Version" row; DESIGN_MAP.md "Handoff used" naming the matching
 * handoff). Time since the last edit is reported beside it and does not affect completeness.
 */
export function versionInfo(w: World, slice: string, kind: 'handoff' | 'design'): VersionInfo[] {
  const out: VersionInfo[] = [];
  let prev: string[] = [];
  for (const v of versions(w, slice, kind)) {
    const dir = versionDir(slice, kind, v);
    const files = (w.listDir(dir) ?? []).filter((f) => f.endsWith('.md')).sort();
    const reasons: string[] = [];
    const required = REQUIRED_FILES[kind](vnum(v)).filter((f) => !files.includes(f));
    if (required.length) reasons.push(`missing ${required.join(', ')}, required by the handoff contract`);
    const missing = prev.filter((f) => !files.includes(f) && !required.includes(f));
    if (missing.length) reasons.push(`missing ${missing.join(', ')}, which ${out[out.length - 1]?.version} has`);
    const empty = files.filter((f) => !(w.readFile(`${dir}/${f}`) ?? '').trim());
    if (empty.length) reasons.push(`empty: ${empty.join(', ')}`);
    if (kind === 'handoff' && files.includes('HANDOFF.md') && !new RegExp(`^\\| \\*\\*Version\\*\\* \\| ${v}\\b`, 'm').test(w.readFile(`${dir}/HANDOFF.md`) ?? ''))
      reasons.push(`HANDOFF.md has no "Version" row naming ${v}`);
    if (kind === 'design' && files.includes('DESIGN_MAP.md') && !new RegExp(`Handoff used[^\\n]*${HANDOFFS}/${slice}/${v}/`).test(w.readFile(`${dir}/DESIGN_MAP.md`) ?? ''))
      reasons.push(`DESIGN_MAP.md has no "Handoff used" naming handoff ${v}`);
    const mtimes = files.map((f) => w.stat(`${dir}/${f}`)?.mtimeMs).filter((m): m is number => m !== undefined);
    const last = mtimes.length ? Math.max(...mtimes) : null;
    out.push({ source: `${kind} ${slice}`, version: v, files, complete: !reasons.length, reasons, lastEdited: last === null ? null : new Date(last).toISOString(), recentlyEdited: last !== null && w.scanStartedMs - last < RECENT_EDIT_MS });
    prev = files;
  }
  return out;
}

/** The Markdown file an item lives in, for one version. */
function mdIn(w: World, p: ParsedRef, version: string, figmaSlice?: string): string | null {
  if (p.scheme === 'handoff') return w.readFile(`${versionDir(p.slice, 'handoff', version)}/${itemFile(p)}`);
  if (p.scheme === 'design-map') return w.readFile(`${versionDir(p.slice, 'design', version)}/DESIGN_MAP.md`);
  if (p.scheme === 'figma' && figmaSlice) return w.readFile(`${versionDir(figmaSlice, 'design', version)}/DESIGN_MAP.md`);
  return null;
}

/** The text of a handoff or design-map item in one version, or null when the version or the item is absent. */
function itemIn(w: World, p: ParsedRef, version: string): string | null {
  if (p.scheme !== 'handoff' && p.scheme !== 'design-map') return null;
  const md = mdIn(w, p, version);
  return md === null ? null : recordText(md, p.id) || null;
}

const cells = (row: string) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());

/** Each table row that starts with the id, with the header of the table it sits in. */
function rowsWithHeaders(md: string, id: string): { header: string[]; row: string[] }[] {
  const lines = md.split('\n');
  const out: { header: string[]; row: string[] }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith(`| ${id} |`)) continue;
    let j = i - 1;
    while (j > 0 && lines[j].startsWith('|') && !/^\|\s*:?-{3,}/.test(lines[j])) j--;
    const header = j > 0 && /^\|\s*:?-{3,}/.test(lines[j]) ? cells(lines[j - 1]) : [];
    out.push({ header, row: cells(lines[i]) });
  }
  return out;
}

/**
 * Compares an item's table rows cell by cell, pairing columns by header name. Returns null when the item
 * is not purely table rows, or rows cannot be paired (different counts or tables without headers).
 */
export function compareCells(pinnedMd: string, latestMd: string, id: string): CellComparison | null {
  const a = rowsWithHeaders(pinnedMd, id);
  const b = rowsWithHeaders(latestMd, id);
  if (!a.length || a.length !== b.length || a.some((r) => !r.header.length) || b.some((r) => !r.header.length)) return null;
  if (recordText(pinnedMd, id).split('\n').some((l) => l.startsWith('#')) || recordText(latestMd, id).split('\n').some((l) => l.startsWith('#'))) return null;
  const res: CellComparison = { layoutOnly: true, changed: [], addedColumns: [], removedColumns: [] };
  for (let k = 0; k < a.length; k++) {
    const pa = new Map(a[k].header.map((h, i) => [h, a[k].row[i] ?? '']));
    const pb = new Map(b[k].header.map((h, i) => [h, b[k].row[i] ?? '']));
    if (pa.size !== a[k].header.length || pb.size !== b[k].header.length) return null; // duplicate header names
    for (const [h, v] of pa) {
      if (!pb.has(h)) res.removedColumns.push({ column: h, value: v });
      else if (pb.get(h) !== v) res.changed.push({ column: h, from: v, to: pb.get(h)! });
    }
    for (const [h, v] of pb) if (!pa.has(h)) res.addedColumns.push({ column: h, value: v });
  }
  res.layoutOnly = !res.changed.length && !res.removedColumns.length && res.addedColumns.every((c) => c.value === '');
  return res;
}

/**
 * Follows Figma frames through one design map. A frame linked in the map stays. A frame only named in a
 * reconciliation row (a line marked stale that links other frames) is replaced by them. A frame listed by its
 * bare id in a map for that file, e.g. a "Carried frames" row, stays. Otherwise it is absent.
 */
function followFrames(md: string, fileKey: string, nodes: string[]): { kept: string[]; replaced: { from: string; to: string[]; line: string }[]; absent: string[] } {
  const lines = md.split('\n');
  const kept: string[] = [];
  const replaced: { from: string; to: string[]; line: string }[] = [];
  const absent: string[] = [];
  for (const n of nodes) {
    const link = new RegExp(`${fileKey}/[^)]*node-id=${n}\\)`);
    if (lines.some((l) => link.test(l))) {
      kept.push(n);
      continue;
    }
    const mentions = lines.filter((l) => new RegExp(`(^|[^\\d-])${n}([^\\d-]|$)`).test(l));
    const named = mentions.find((l) => /stale/i.test(l) && /node-id=\d+-\d+/.test(l));
    if (named) replaced.push({ from: n, to: [...named.matchAll(/node-id=(\d+-\d+)\)/g)].map((m) => m[1]).filter((x) => x !== n), line: named.trim() });
    else if (mentions.length && md.includes(fileKey)) kept.push(n);
    else absent.push(n);
  }
  return { kept, replaced, absent };
}

/** The file a revision's hash was taken of, if the revision names one. */
function revisionFile(rev: Revision, p: ParsedRef | null): string | null {
  const name = `${rev.version} ${rev.how}`.match(/[A-Z][A-Z_]+\.md/)?.[0];
  if (!name) return null;
  if (rev.source === 'archive') return `${SPEC}/${name}`;
  const slice = p && (p.scheme === 'handoff' || p.scheme === 'design-map') ? p.slice : null;
  const v = rev.version.match(/v\d+/)?.[0];
  if (!slice || !v) return null;
  return rev.source === 'handoff' ? `${versionDir(slice, 'handoff', v)}/${name}` : rev.source === 'design' ? `${versionDir(slice, 'design', v)}/${name}` : null;
}

function findElement(m: MachineDef | undefined, id?: string) {
  if (!m) return undefined;
  if (!id) return m;
  return m.states.find((s) => s.id === id) ?? m.transitions.find((t) => t.id === id);
}

// ---- versioned items (handoff rows, design rows, Figma frames) ----------------------------------------
function analyseVersioned(w: World, p: Extract<ParsedRef, { scheme: 'handoff' | 'design-map' | 'figma' }>, rev: Revision | undefined, figmaSlice: string | undefined, base: RefReport): RefReport {
  const kind = p.scheme === 'handoff' ? 'handoff' : 'design';
  const slice = p.scheme === 'figma' ? figmaSlice : p.slice;
  // figma frames are pinned through the design-map revision they were recorded against
  const pinned = p.scheme === 'figma' ? rev?.version.match(/v\d+/)?.[0] : p.version;
  if (!slice || !pinned) {
    base.integrity = { status: 'unavailable', precision: 'none', detail: 'no pinned design version recorded for this frame' };
    base.later.detail = base.integrity.detail;
    return base;
  }
  const label = p.scheme === 'figma' ? `frame ${p.node}` : p.id;
  const pinnedMd = mdIn(w, p, pinned, slice);
  const pinnedText = p.scheme === 'figma' ? (pinnedMd && followFrames(pinnedMd, p.fileKey, [p.node]).kept.length ? 'listed' : null) : itemIn(w, p, pinned);

  // pinned integrity
  if (pinnedText === null) base.integrity = { status: 'unresolved', precision: 'item', detail: `${label} not found in ${versionDir(slice, kind, pinned)}/${itemFile(p)}` };
  else {
    const file = rev ? revisionFile(rev, p.scheme === 'figma' ? { scheme: 'design-map', slice, version: pinned, id: '' } : p) : null;
    const now = file ? w.readFile(file) : null;
    if (!rev?.hash || !file) base.integrity = { status: 'matches', precision: 'none', detail: 'resolves; the recorded revision has no content hash to compare' };
    else if (now === null) base.integrity = { status: 'unresolved', precision: 'file', detail: `${file} is missing` };
    else if (sha256(now) === rev.hash) base.integrity = { status: 'matches', precision: 'file', detail: `${file} is byte-identical to the recorded revision, so the item is unchanged` };
    else base.integrity = { status: 'differs', precision: 'file', detail: `${file} differs from the recorded revision. No fingerprint of the item itself was recorded, so whether this item changed is unknown` };
  }

  // later versions
  const infos = versionInfo(w, slice, kind);
  const later = infos.filter((v) => vnum(v.version) > vnum(pinned));
  const latest = infos[infos.length - 1]?.version ?? pinned;
  base.later = { status: 'no-later', precision: p.scheme === 'figma' ? 'none' : 'item', pinned, latest, steps: [], detail: '' };
  if (pinnedText === null || pinnedMd === null) {
    base.later = { ...base.later, status: 'unmatched', precision: 'none', detail: 'the item cannot be read in its pinned version, so later versions cannot be compared' };
    return base;
  }
  if (!later.length) {
    base.later.detail = `no version after ${pinned} in ${versionDir(slice, kind, '').replace(/\/$/, '')}`;
    return base;
  }

  if (p.scheme === 'figma') {
    // follow the frame through replacement rows, version by version
    let nodes = [p.node];
    const chain: string[] = [];
    for (const v of later) {
      const md = mdIn(w, p, v.version, slice);
      const f = md ? followFrames(md, p.fileKey, nodes) : { kept: [], replaced: [], absent: nodes };
      const st: VersionStep['status'] = f.absent.length ? (v.complete ? 'removed' : 'inconclusive') : f.replaced.length ? 'replaced' : 'unchanged';
      for (const r of f.replaced) chain.push(`${v.version}: ${r.from} → ${r.to.join(', ') || '(no successor linked)'}`);
      base.later.steps.push({ version: v.version, status: st, complete: v.complete, ...(f.replaced.length ? { note: f.replaced.map((r) => `"${r.line.slice(0, 160)}"`).join(' ') } : {}) });
      nodes = [...f.kept, ...f.replaced.flatMap((r) => r.to)];
      if (!nodes.length) break;
    }
    const r = summariseSteps(base, later, label, chain.length ? `followed through the design maps: ${chain.join('; ')}. Figma itself was not read` : 'Figma itself was not read; only the design maps were');
    // a frame the design map no longer names may have been moved, replaced or deleted in Figma: not an established removal
    if (r.later.status === 'removed') r.later = { ...r.later, status: 'unmatched', detail: `${label} is not named in ${r.later.basedOn ?? r.later.latest}/DESIGN_MAP.md; whether it was replaced, moved or deleted cannot be told without reading Figma. ${r.later.detail}` };
    return r;
  }

  for (const v of later) {
    const t = itemIn(w, p, v.version);
    const changes = p.scheme === 'handoff' ? w.readFile(`${versionDir(slice, 'handoff', v.version)}/CHANGES.md`) : null;
    const declared = changes ? changes.split('\n').filter((l) => l.startsWith(`| ${p.id} |`) || new RegExp(`^\\| [^|]*\\b${p.id}\\b`).test(l)) : [];
    let status: VersionStep['status'];
    if (t === null) status = v.complete ? 'removed' : 'inconclusive';
    else if (t === pinnedText) status = 'unchanged';
    else status = compareCells(pinnedMd, mdIn(w, p, v.version) ?? '', p.id)?.layoutOnly ? 'unchanged' : 'changed';
    base.later.steps.push({ version: v.version, status, complete: v.complete, ...(declared.length ? { declared } : {}) });
  }
  const r = summariseSteps(base, later, label, '');
  // the difference to the version the status is based on
  const target = r.later.basedOn ?? r.later.latest;
  const targetText = itemIn(w, p, target);
  if (targetText !== null && targetText !== pinnedText) {
    r.later.diff = wordDiff(pinnedText, targetText);
    const cc = compareCells(pinnedMd, mdIn(w, p, target) ?? '', p.id);
    if (cc) {
      r.later.cells = cc;
      const cols = [...cc.changed.map((c) => `"${c.column}" changed`), ...cc.addedColumns.filter((c) => c.value).map((c) => `new "${c.column}" = "${c.value}"`), ...cc.removedColumns.map((c) => `"${c.column}" removed`)];
      r.later.detail += cc.layoutOnly ? `; cells identical, the table gained empty column(s): ${cc.addedColumns.map((c) => `"${c.column}"`).join(', ')}` : cols.length ? `; by column: ${cols.join(', ')}` : '';
    }
  }
  return r;
}

/** Turns per-version steps into one status, based on the newest complete version; incomplete ones are provisional. */
function summariseSteps(base: RefReport, later: VersionInfo[], label: string, extra: string): RefReport {
  const steps = base.later.steps;
  const completeSteps = steps.filter((s) => s.complete);
  const basis = completeSteps[completeSteps.length - 1];
  const newest = steps[steps.length - 1];
  const firstChange = steps.find((s) => s.status !== 'unchanged' && s.status !== 'inconclusive');
  const incompleteVs = later.filter((v) => !v.complete);
  const why = incompleteVs.map((v) => `${v.version}: ${v.reasons.join('; ')}`).join('; ');
  if (!basis) {
    // only incomplete later versions exist: absences are inconclusive, changes provisional
    base.later.status = newest.status === 'unchanged' ? 'later-unchanged' : newest.status === 'changed' || newest.status === 'replaced' ? 'changed' : 'inconclusive';
    base.later.firstChangedIn = firstChange?.version;
    base.later.provisional = `only incomplete later versions exist (${why})`;
    base.later.detail = `in ${newest.version}: ${newest.status}, provisional`;
  } else {
    base.later.basedOn = basis.version !== base.later.latest ? basis.version : undefined;
    base.later.status = basis.status === 'unchanged' ? 'later-unchanged' : basis.status === 'changed' || basis.status === 'replaced' ? 'changed' : 'removed';
    base.later.firstChangedIn = basis.status === 'unchanged' ? undefined : steps.find((s) => s.complete && s.status !== 'unchanged')?.version;
    base.later.detail =
      basis.status === 'unchanged'
        ? firstChange && firstChange.complete
          ? `identical to ${base.later.pinned} in ${basis.version}, though it differed in ${firstChange.version}`
          : `identical in every complete later version up to ${basis.version}`
        : basis.status === 'removed'
          ? `${label} not found in ${basis.version}`
          : `${basis.status === 'replaced' ? 'replaced' : `text differs from ${base.later.pinned}`} (first in ${base.later.firstChangedIn})`;
    if (newest !== basis) base.later.provisional = `${newest.version} is incomplete (${why}); there it is ${newest.status}`;
  }
  if (extra) base.later.detail += `; ${extra}`;
  return base;
}

// ---- per-reference analysis ---------------------------------------------------------------------------
function analyse(w: World, data: TraceData, ref: string, rev: Revision | undefined, recordedHashes: string[], figmaSlice: string | undefined): RefReport {
  const p = parseRef(ref);
  const base: RefReport = {
    ref,
    scheme: p?.scheme ?? 'unknown',
    rev: rev?.id,
    integrity: { status: 'unresolved', precision: 'none', detail: 'unrecognised reference' },
    later: { status: 'unavailable', precision: 'none', pinned: '?', latest: '?', steps: [], detail: 'unrecognised reference' },
    usedBy: [],
    files: [],
  };
  if (!p) return base;

  switch (p.scheme) {
    case 'handoff':
    case 'design-map':
    case 'figma':
      return analyseVersioned(w, p, rev, figmaSlice, base);

    case 'model': {
      const commit = short(w.repo.baseline);
      const latestLabel = `working tree${w.repo.head ? ` at ${short(w.repo.head)}` : ''}${w.repo.modelDirty ? ' (src/model has uncommitted changes)' : ''}`;
      const cur = findElement(w.current.machines[p.machine], p.element);
      const curHash = cur ? elementHash(w.current.machines[p.machine], p.element) : null;
      if (!w.baseline) {
        base.integrity = { status: 'unavailable', precision: 'none', detail: `the model at ${commit} could not be loaded` };
        base.later = { status: 'unavailable', precision: 'none', pinned: commit, latest: latestLabel, steps: [], detail: base.integrity.detail };
        return base;
      }
      const bm = w.baseline.machines[p.machine];
      const bel = findElement(bm, p.element);
      const bHash = bel ? elementHash(bm, p.element) : null;
      if (!bel) base.integrity = { status: 'unresolved', precision: 'item', detail: `not present in the model at ${commit}` };
      else if (!recordedHashes.length) base.integrity = { status: 'matches', precision: 'none', detail: `present at ${commit}; no element hash was recorded for this reference` };
      else if (recordedHashes.every((h) => h === bHash)) base.integrity = { status: 'matches', precision: 'item', detail: `the recorded element hash equals the element at ${commit}` };
      else base.integrity = { status: 'differs', precision: 'item', detail: `a recorded element hash does not equal the element at ${commit}` };

      base.later = { status: 'no-later', precision: 'item', pinned: commit, latest: latestLabel, steps: [], detail: '' };
      const moved = w.repo.head !== w.repo.baseline || !!w.repo.modelDirty;
      if (!cur) base.later = { ...base.later, status: 'removed', detail: `not present in the ${latestLabel}` };
      else if (curHash === bHash) base.later = { ...base.later, status: moved ? 'later-unchanged' : 'no-later', detail: moved ? `element definition identical in the ${latestLabel}` : 'no change after the baseline' };
      else
        base.later = {
          ...base.later,
          status: 'changed',
          firstChangedIn: latestLabel,
          diff: bel ? wordDiff(canonicalJson(bel).replace(/[{}",]/g, ' '), canonicalJson(cur).replace(/[{}",]/g, ' ')) : undefined,
          detail: `element definition differs from ${commit}`,
        };
      base.dependencies = dependencies(w, p.machine, p.element);
      return base;
    }

    case 'model-scenario': {
      const commit = short(w.repo.baseline);
      const b = w.baseline?.scenarios.find((s) => s.id === p.id);
      const c = w.current.scenarios.find((s) => s.id === p.id);
      if (!w.baseline) base.integrity = { status: 'unavailable', precision: 'none', detail: `the model at ${commit} could not be loaded` };
      else base.integrity = b ? { status: 'matches', precision: 'none', detail: `present at ${commit}` } : { status: 'unresolved', precision: 'item', detail: `not present at ${commit}` };
      const same = b && c && canonicalJson(b) === canonicalJson(c);
      base.later = {
        status: !c ? 'removed' : !b ? 'unavailable' : same ? (w.repo.head !== w.repo.baseline ? 'later-unchanged' : 'no-later') : 'changed',
        precision: 'item',
        pinned: commit,
        latest: 'working tree',
        steps: [],
        detail: !c ? 'not present in the working tree' : same ? 'scenario definition identical' : 'scenario definition differs',
      };
      return base;
    }

    case 'spec': {
      const file = rev ? revisionFile(rev, null) : null;
      if (/^[QC]-/.test(p.id)) {
        const b = w.baseline?.questions.find((q) => q.id === p.id);
        const c = w.current.questions.find((q) => q.id === p.id);
        base.integrity = !w.baseline ? { status: 'unavailable', precision: 'none', detail: 'baseline model not loaded' } : b ? { status: 'matches', precision: 'none', detail: 'present at the baseline' } : { status: 'unresolved', precision: 'item', detail: 'not in the baseline open questions' };
        base.later = { status: !c ? 'removed' : b && canonicalJson(b) === canonicalJson(c) ? 'no-later' : 'changed', precision: 'item', pinned: short(w.repo.baseline), latest: 'working tree', steps: [], detail: 'open question in src/model/questions.ts' };
        return base;
      }
      const recorded = file ? rev?.hash ?? w.archiveRecorded[file] : undefined;
      const now = file ? w.readFile(file) : null;
      if (!file || !recorded) base.integrity = { status: 'matches', precision: 'none', detail: 'id resolves; no archive file hash recorded for it' };
      else if (now === null) base.integrity = { status: 'unresolved', precision: 'file', detail: `${file} is missing` };
      else if (sha256(now) === recorded) base.integrity = { status: 'matches', precision: 'file', detail: `${file} is byte-identical to the recorded revision` };
      else if (w.currentSpecText && w.specText(p.id) !== undefined) {
        const same = w.specText(p.id) === w.currentSpecText(p.id);
        base.integrity = {
          status: same ? 'matches' : 'differs',
          precision: 'item',
          detail: same ? `${file} changed, but this id's extracted wording is identical to the baseline extraction` : `${file} changed and this id's extracted wording differs from the baseline extraction`,
        };
      } else {
        const text = w.specText(p.id);
        const found = text ? now.includes(text) : false;
        base.integrity = {
          status: found ? 'matches' : 'differs',
          precision: found ? 'item' : 'file',
          detail: found ? `${file} changed, but this id's extracted wording still appears verbatim` : `${file} changed and this id's extracted wording is not found verbatim (changed, or only reformatted)`,
        };
      }
      base.later = { status: 'not-versioned', precision: 'none', pinned: rev?.version ?? 'archive', latest: 'archive (working copy)', steps: [], detail: 'the source documents are not versioned by folder; any authority held in an external service is not checked offline' };
      return base;
    }

    case 'code':
    case 'test': {
      const repo = w.repos[p.repo];
      if (!repo) {
        base.integrity = { status: 'unavailable', precision: 'none', detail: `repository ${p.repo} is not available on this machine` };
        base.later = { status: 'unavailable', precision: 'none', pinned: short(p.sha), latest: '?', steps: [], detail: base.integrity.detail };
        return base;
      }
      const at = repo.commitExists(p.sha) ? repo.show(p.sha, p.path) : null;
      const pinnedLines = at?.split('\n') ?? [];
      let snippet: string | null = null;
      if (at === null) base.integrity = { status: 'unresolved', precision: 'commit', detail: repo.commitExists(p.sha) ? `${p.path} not at ${short(p.sha)}` : `commit ${short(p.sha)} not found` };
      else if (p.scheme === 'code') {
        if (p.to > pinnedLines.length) base.integrity = { status: 'unresolved', precision: 'commit', detail: `line ${p.to} is past the end of the file at ${short(p.sha)}` };
        else {
          snippet = pinnedLines.slice(p.from - 1, p.to).join('\n');
          base.integrity = { status: 'matches', precision: 'commit', detail: `content-addressed: the lines at ${short(p.sha)} are as recorded` };
        }
      } else {
        snippet = testBlock(pinnedLines, p.name);
        base.integrity = snippet ? { status: 'matches', precision: 'commit', detail: `test ${p.name} present at ${short(p.sha)}` } : { status: 'unresolved', precision: 'commit', detail: `no test ${p.name} at ${short(p.sha)}` };
      }
      const head = repo.head;
      base.later = { status: 'no-later', precision: 'item', pinned: short(p.sha), latest: `HEAD ${short(head)}`, steps: [], detail: '' };
      if (snippet === null) base.later = { ...base.later, status: 'unmatched', precision: 'none', detail: 'the pinned item cannot be read' };
      else if (head.startsWith(p.sha)) base.later.detail = 'HEAD is the pinned commit';
      else if (repo.blob(p.sha, p.path) === repo.blob(head, p.path)) base.later = { ...base.later, status: 'later-unchanged', precision: 'file', detail: `file identical at HEAD ${short(head)}` };
      else {
        const headText = repo.show(head, p.path);
        if (headText === null) base.later = { ...base.later, status: 'removed', detail: `${p.path} not at HEAD` };
        else if (p.scheme === 'code') {
          const idx = headText.indexOf(snippet);
          if (idx < 0) base.later = { ...base.later, status: 'changed', diff: wordDiff(snippet, ''), detail: 'the pinned lines are not found verbatim at HEAD' };
          else {
            const line = headText.slice(0, idx).split('\n').length;
            base.later = { ...base.later, status: 'later-unchanged', detail: `the pinned lines appear verbatim at HEAD L${line}-L${line + p.to - p.from}` };
          }
        } else {
          const block = testBlock(headText.split('\n'), p.name);
          base.later = !block
            ? { ...base.later, status: 'removed', detail: `no test ${p.name} at HEAD` }
            : block === snippet
              ? { ...base.later, status: 'later-unchanged', detail: 'test body identical at HEAD (block boundaries found heuristically)' }
              : { ...base.later, status: 'changed', diff: wordDiff(snippet, block), detail: 'test body differs at HEAD (block boundaries found heuristically)' };
        }
      }
      if (repo.dirty(p.path)) base.later.detail += `; ${p.path} also has uncommitted changes, which were not inspected`;
      return base;
    }

    case 'notion':
      base.integrity = { status: 'unavailable', precision: 'none', detail: `Notion is not read by this report${rev ? `; last checked ${rev.checkedAt} (${rev.how})` : ''}` };
      base.later = { status: 'unavailable', precision: 'none', pinned: rev?.version ?? '?', latest: 'not checked', steps: [], detail: 'an offline comparison is not a fresh check of Notion' };
      return base;

    default:
      base.integrity = { status: 'matches', precision: 'none', detail: 'internal trace reference' };
      base.later = { status: 'not-versioned', precision: 'none', pinned: '-', latest: '-', steps: [], detail: '' };
      return base;
  }
}

/** A test's block: from its definition line to the next definition at the same or lower indentation. */
function testBlock(lines: string[], name: string): string | null {
  const start = lines.findIndex((l) => new RegExp(`\\b(def|fun|function)\\s+${name}\\s*\\(`).test(l));
  if (start < 0) return null;
  const indent = lines[start].match(/^\s*/)![0].length;
  let end = start + 1;
  while (end < lines.length) {
    const l = lines[end];
    if (l.trim() && l.match(/^\s*/)![0].length <= indent && /^\s*(def |fun |function |@|class |async def |private |internal )/.test(l)) break;
    end++;
  }
  return lines.slice(start, end).join('\n').trimEnd();
}

/** Recorded dependencies of an element that its own hash does not cover, compared baseline → working tree. */
function dependencies(w: World, machineId: string, elementId?: string): { checked: DependencyCheck[]; unchecked: string[] } {
  const checked: DependencyCheck[] = [];
  const b = w.baseline!;
  const c = w.current;
  const cmp = (label: string, bm: MachineDef | undefined, cm: MachineDef | undefined, id?: string) => {
    const bh = bm ? elementHash(bm, id) : null;
    const ch = cm ? elementHash(cm, id) : null;
    checked.push({ dependency: label, status: !bh ? 'unavailable' : !ch ? 'removed' : bh === ch ? 'unchanged' : 'changed' });
  };
  const bm = b.machines[machineId];
  const el = findElement(bm, elementId) as (MachineDef | (MachineDef['states'][number] & { from?: string; to?: string; open?: { questions: string[] }; refs?: string[] })) | undefined;
  if (elementId) cmp(`machine rules and header: ${machineId}`, bm, c.machines[machineId]);
  if (el && 'from' in el && el.from) {
    cmp(`from-state: ${machineId}/${el.from}`, bm, c.machines[machineId], el.from);
    cmp(`to-state: ${machineId}/${(el as { to: string }).to}`, bm, c.machines[machineId], (el as { to: string }).to);
  }
  if (el && 'uses' in el && el.uses) cmp(`used component header: ${el.uses}`, b.machines[el.uses], c.machines[el.uses]);
  for (const m of Object.values(b.machines)) for (const s of m.states) if (s.uses === machineId) cmp(`composite that stands for this component: ${m.id}/${s.id}`, m, c.machines[m.id], s.id);
  for (const q of (el && 'open' in el && el.open?.questions) || []) {
    const bq = b.questions.find((x) => x.id === q);
    const cq = c.questions.find((x) => x.id === q);
    checked.push({ dependency: `open question ${q}`, status: !bq ? 'unavailable' : !cq ? 'removed' : canonicalJson(bq) === canonicalJson(cq) ? 'unchanged' : 'changed' });
  }
  const cited = (el && 'refs' in el && el.refs) || [];
  if (cited.length) {
    const changedFiles = Object.entries(w.archiveRecorded).filter(([f, h]) => {
      const t = w.readFile(f);
      return t === null || sha256(t) !== h;
    });
    if (!changedFiles.length) checked.push({ dependency: `archive wording of cited ids (${cited.length})`, status: 'unchanged', detail: 'every archive file matches SOURCE_VERSIONS.md at the baseline' });
    else {
      const archive = Object.keys(w.archiveRecorded).map((f) => w.readFile(f) ?? '').join('\n');
      const cur = w.currentSpecText;
      const missing = cited.filter((id) => {
        const t = w.specText(id);
        return t && (cur ? cur(id) !== t : !archive.includes(t));
      });
      checked.push({
        dependency: `archive wording of cited ids (${cited.length})`,
        status: missing.length ? 'changed' : 'unchanged',
        detail: missing.length
          ? `${cur ? 'extracted wording differs from the baseline extraction' : 'wording not found verbatim'} for ${missing.join(', ')} (changed archive files: ${changedFiles.map(([f]) => f.split('/').pop()).join(', ')})`
          : `archive files changed (${changedFiles.map(([f]) => f.split('/').pop()).join(', ')}), but every cited id's ${cur ? 'extracted wording is identical to the baseline extraction' : 'wording still appears verbatim'}`,
      });
    }
  }
  const unchecked = [
    'wording of the cited decisions and criteria held in an external service such as Notion (not read offline)',
    'decisions recorded only in conversation and not yet in the source documents or the model',
    'elements more than one step away: siblings, and composites of composites',
    'later decisions that supersede a cited id without changing its own wording',
  ];
  return { checked, unchecked };
}

// ---- the report ---------------------------------------------------------------------------------------
const FLAG: Record<string, Reason['kind'] | undefined> = { differs: 'pinned-differs', unresolved: 'pinned-unresolved', changed: 'later-changed', removed: 'later-removed', unmatched: 'later-unmatched' };

function reasonsFor(r: RefReport | undefined): Reason[] {
  if (!r) return [];
  const out: Reason[] = [];
  const ik = FLAG[r.integrity.status];
  if (ik) out.push({ ref: r.ref, kind: ik, path: `${r.ref}: pinned reference ${r.integrity.status} (${r.integrity.detail})` });
  const lk = FLAG[r.later.status];
  if (lk)
    out.push({
      ref: r.ref,
      kind: lk,
      path: `${r.ref}: pinned ${r.later.pinned}, ${r.later.basedOn ? `complete ${r.later.basedOn} (latest inspected ${r.later.latest} is incomplete)` : `latest inspected ${r.later.latest}`}: ${r.later.status}${r.later.firstChangedIn ? ` (first in ${r.later.firstChangedIn})` : ''}${r.later.provisional && !r.later.basedOn ? ', provisional' : ''}`,
    });
  for (const d of r.dependencies?.checked ?? [])
    if (d.status === 'changed' || d.status === 'removed') out.push({ ref: r.ref, kind: 'dependency-changed', path: `${r.ref}: its dependency "${d.dependency}" is ${d.status}${d.detail ? ` (${d.detail})` : ''}; the element's own definition is compared separately` });
  return out;
}

/** A World whose reads are taken once, recorded, and can be re-checked after the scan. */
export function snapshotWorld(w: World): World & { inspected(): InspectedFile[]; recheck(): string[] } {
  const files = new Map<string, string | null>();
  const dirs = new Map<string, string[] | null>();
  const stats = new Map<string, { mtimeMs: number } | null>();
  return {
    ...w,
    readFile: (rel) => {
      if (!files.has(rel)) files.set(rel, w.readFile(rel));
      return files.get(rel)!;
    },
    listDir: (rel) => {
      if (!dirs.has(rel)) dirs.set(rel, w.listDir(rel));
      return dirs.get(rel)!;
    },
    stat: (rel) => {
      if (!stats.has(rel)) stats.set(rel, w.stat(rel));
      return stats.get(rel)!;
    },
    inspected: () =>
      [...files.entries()]
        .map(([path, t]) => {
          const st = stats.has(path) ? stats.get(path) : w.stat(path);
          return { path, sha256: t === null ? null : sha256(t), mtime: st ? new Date(st.mtimeMs).toISOString() : null };
        })
        .sort((a, b) => a.path.localeCompare(b.path)),
    recheck: () => {
      const changed: string[] = [];
      for (const [rel, t] of files) if (w.readFile(rel) !== t) changed.push(rel);
      for (const [rel, d] of dirs) if (JSON.stringify(w.listDir(rel)) !== JSON.stringify(d)) changed.push(`${rel}/`);
      return changed.sort();
    },
  };
}

/**
 * Marks entries that read a file which changed during the scan as inconclusive, and the snapshot as unstable.
 * Nothing is combined across two states of a file: each entry was computed from one consistent read.
 */
export function applyInstability(rep: StalenessReport, changed: string[], attempts: number): StalenessReport {
  rep.inspection.attempts = attempts;
  rep.inspection.changedDuringScan = changed;
  rep.inspection.stable = !changed.length;
  if (!changed.length) return rep;
  const touched = (r: RefReport) => r.files.some((f) => changed.some((c) => (c.endsWith('/') ? f === c || f.startsWith(c) : f === c)));
  const unstable = new Set<string>();
  for (const r of rep.refs)
    if (touched(r)) {
      unstable.add(r.ref);
      r.later = { ...r.later, status: 'inconclusive', detail: `inconclusive: a file this comparison read changed during the scan (${changed.join(', ')}). ${r.later.detail}` };
    }
  rep.affected = rep.affected.map((a) => ({ ...a, reasons: a.reasons.filter((x) => !(unstable.has(x.ref) && x.kind.startsWith('later-'))) })).filter((a) => a.reasons.length);
  rep.incomplete.unshift(`UNSTABLE SNAPSHOT: ${changed.length} source(s) changed during the scan (${changed.join(', ')}); ${unstable.size} comparison(s) that read them are inconclusive`);
  rep.status = `UNSTABLE SNAPSHOT. ${rep.status}`;
  recount(rep);
  return rep;
}

/**
 * An identifier for exactly what a report read: every inspected file's path and content hash, the model and
 * trace-data fingerprints and the repository commit. Two reports with the same id compared the same inputs.
 */
export function snapshotId(rep: StalenessReport): string {
  const lines = [...rep.inspection.files.map((f) => `${f.path}=${f.sha256 ?? 'absent'}`), `model=${rep.fingerprints.model}`, `trace=${rep.fingerprints.traceData}`, `repo=${rep.baseline.head ?? '-'}${rep.baseline.modelDirty ? '+dirty' : ''}`];
  return `snap-${sha256(lines.join('\n')).slice(0, 12)}`;
}

function recount(rep: StalenessReport) {
  const refs = rep.refs;
  const count = (pred: (r: RefReport) => boolean) => refs.filter(pred).length;
  rep.summary = {
    references: refs.length,
    'pinned: matches': count((r) => r.integrity.status === 'matches'),
    'pinned: differs': count((r) => r.integrity.status === 'differs'),
    'pinned: cannot resolve': count((r) => r.integrity.status === 'unresolved'),
    'pinned: cannot check': count((r) => r.integrity.status === 'unavailable'),
    'later: none found': count((r) => r.later.status === 'no-later'),
    'later: item unchanged': count((r) => r.later.status === 'later-unchanged'),
    'later: changed': count((r) => r.later.status === 'changed'),
    'later: removed': count((r) => r.later.status === 'removed'),
    'later: cannot match': count((r) => r.later.status === 'unmatched'),
    'later: inconclusive': count((r) => r.later.status === 'inconclusive'),
    'later: not versioned or cannot check': count((r) => r.later.status === 'not-versioned' || r.later.status === 'unavailable'),
    'later: with a provisional note from an incomplete version': count((r) => !!r.later.provisional),
    'dependency changed': count((r) => !!r.dependencies?.checked.some((d) => d.status === 'changed' || d.status === 'removed')),
    'needs review: links': rep.affected.filter((a) => a.subject === 'link').length,
    'needs review: findings': rep.affected.filter((a) => a.subject === 'finding').length,
    'needs review: work items': rep.affected.filter((a) => a.subject === 'work-item').length,
    'needs review: gaps': rep.affected.filter((a) => a.subject === 'gap').length,
    'needs review: records': rep.affected.filter((a) => a.subject === 'record').length,
  };
}

export function computeStaleness(data: TraceData, w: World, opts: { tool?: string; traceDataSha256?: string } = {}): StalenessReport {
  const revs = new Map(data.revisions.map((r) => [r.id, r]));
  const incomplete: string[] = [];
  // the revision and recorded hashes each reference carries
  const revOf = new Map<string, string>();
  const hashesOf = new Map<string, Set<string>>();
  const usedBy = new Map<string, Set<string>>();
  const use = (ref: string, by: string, rev?: string, hash?: string) => {
    if (!usedBy.has(ref)) usedBy.set(ref, new Set());
    usedBy.get(ref)!.add(by);
    if (rev && !revOf.has(ref)) revOf.set(ref, rev);
    if (hash) (hashesOf.get(ref) ?? hashesOf.set(ref, new Set()).get(ref)!).add(hash);
  };
  for (const l of data.links) {
    use(l.from.ref, l.id, l.from.rev, l.from.elementHash);
    use(l.to.ref, l.id, l.to.rev, l.to.elementHash);
  }
  for (const r of data.records) use(r.ref, `record ${r.ref}`, r.rev);
  for (const s of data.scenarios) use(s.ref, 'scenario definition', s.rev);
  for (const t of data.tests) use(t.ref, 'test definition', t.rev);
  for (const g of data.gaps) use(g.anchor, g.id);
  for (const f of data.findings) for (const r of [...f.targets, ...f.scenarios, f.component]) use(r, f.id);

  // which slice a figma frame belongs to: the slice of the requirements it is recorded against
  const figmaSlice = data.links.map((l) => parseRef(l.to.ref)).find((p): p is Extract<ParsedRef, { scheme: 'handoff' }> => p?.scheme === 'handoff')?.slice;

  const refs: RefReport[] = [];
  for (const ref of [...usedBy.keys()].sort()) {
    const rev = revOf.get(ref) ? revs.get(revOf.get(ref)!) : undefined;
    // track what each comparison reads, so a file that changes during the scan can be traced to it
    const files = new Set<string>();
    const tw: World = { ...w, readFile: (rel) => (files.add(rel), w.readFile(rel)), listDir: (rel) => (files.add(rel + '/'), w.listDir(rel)), stat: (rel) => (files.add(rel), w.stat(rel)) };
    const r = analyse(tw, data, ref, rev, [...(hashesOf.get(ref) ?? [])], figmaSlice);
    r.usedBy = [...usedBy.get(ref)!].sort();
    r.files = [...files].sort();
    refs.push(r);
  }
  const byRef = new Map(refs.map((r) => [r.ref, r]));

  // impact
  const affected: Affected[] = [];
  for (const l of data.links) {
    const reasons = [...reasonsFor(byRef.get(l.from.ref)), ...reasonsFor(byRef.get(l.to.ref))].map((x) => ({ ...x, path: `${l.id} (${l.type}) ← ${x.path}` }));
    if (reasons.length) affected.push({ subject: 'link', id: l.id, label: 'needs review', summary: `${l.from.ref} ${l.type} ${l.to.ref}`, reasons });
  }
  const findingFlags = new Map<string, Reason[]>();
  for (const f of data.findings) {
    const reasons = [...new Set([...f.targets, ...f.scenarios, f.component])].flatMap((r) => reasonsFor(byRef.get(r))).map((x) => ({ ...x, path: `${f.id} ← ${x.path}` }));
    if (reasons.length) {
      findingFlags.set(f.id, reasons);
      affected.push({ subject: 'finding', id: f.id, label: 'needs review', summary: `${f.title} (status stays "${f.status}"; nothing is resolved automatically)`, reasons });
    }
  }
  for (const wi of data.workItems) {
    const reasons = wi.findings.flatMap((id) => findingFlags.get(id) ?? []).map((x) => ({ ...x, path: `${wi.id} ← ${x.path}` }));
    if (reasons.length) affected.push({ subject: 'work-item', id: wi.id, label: 'needs review', summary: `${wi.title} (state stays "${wi.state}")`, reasons });
  }
  for (const g of data.gaps) {
    const reasons = reasonsFor(byRef.get(g.anchor)).map((x) => ({ ...x, path: `${g.id} (${g.kind} ${g.expected.relationship}) ← ${x.path}` }));
    if (reasons.length) affected.push({ subject: 'gap', id: g.id, label: 'needs review', summary: `${g.anchor}: ${g.reason}`, reasons });
  }
  for (const rec of data.records) {
    const rr = byRef.get(rec.ref);
    const reasons = reasonsFor(rr).map((x) => ({ ...x, path: `record ${rec.ref} ← ${x.path}` }));
    if (!reasons.length) continue;
    // where the item exists in the version the status is based on, say whether each quoted status still appears there
    const p = parseRef(rec.ref);
    const target = rr ? rr.later.basedOn ?? rr.later.latest : '';
    const latestText = p && rr ? itemIn(w, p, target) : null;
    const quoteNote = latestText
      ? rec.statuses
          .filter((s) => s.checkIn === 'row' && s.quote)
          .map((s) => `"${s.quote}" ${latestText.includes(s.quote!) ? 'still appears' : 'no longer appears'} in ${target}`)
          .join('; ')
      : '';
    affected.push({ subject: 'record', id: rec.ref, label: 'needs review', summary: `quoted statuses are from the pinned version${quoteNote ? `; ${quoteNote}` : ''}`, reasons });
  }

  // facts that come from services this report does not read
  const externalFacts = data.records.flatMap((rec) => {
    const rev = revs.get(rec.rev);
    const p = parseRef(rec.ref);
    if (p?.scheme === 'notion') return rec.statuses.map((s) => ({ ref: rec.ref, fact: `${rec.title}: ${s.value}`, checkedAt: rev?.checkedAt ?? '?', note: `${rev?.how ?? ''}. Not re-checked: an offline report cannot read Notion` }));
    if (p?.scheme === 'figma') return [{ ref: rec.ref, fact: `${rec.title}: ${rec.statuses.map((s) => s.value).join('; ')}`, checkedAt: rev?.checkedAt ?? '?', note: `as recorded in ${rev?.version ?? 'the design map'}; Figma itself was not opened` }];
    return [];
  });

  // versions and sources examined
  const slices = new Set(refs.map((r) => parseRef(r.ref)).flatMap((p) => (p && (p.scheme === 'handoff' || p.scheme === 'design-map') ? [p.slice] : [])));
  const versionInfos: VersionInfo[] = [];
  const sources: StalenessReport['sources'] = [];
  for (const s of slices)
    for (const kind of ['handoff', 'design'] as const) {
      const infos = versionInfo(w, s, kind);
      versionInfos.push(...infos);
      const scheme = kind === 'handoff' ? 'handoff' : 'design-map';
      const pinnedVs = [...new Set(refs.flatMap((r) => (parseRef(r.ref)?.scheme === scheme && (parseRef(r.ref) as { slice: string }).slice === s ? [r.later.pinned] : [])))];
      const last = infos[infos.length - 1];
      const incompleteVs = infos.filter((i) => !i.complete);
      const recent = infos.filter((i) => i.recentlyEdited);
      sources.push({
        source: `${kind} ${s}`,
        pinned: pinnedVs.join(', '),
        latest: last ? `${last.version}${last.complete ? '' : ' (incomplete draft)'}` : '-',
        note: `versions found: ${infos.map((i) => i.version).join(', ')}${last ? `; ${last.version} holds ${last.files.join(', ') || 'no files'}` : ''}${incompleteVs.length ? `; incomplete: ${incompleteVs.map((i) => `${i.version} (${i.reasons.join('; ')})`).join('; ')}` : ''}${recent.length ? `; edited within ${RECENT_EDIT_MS / 60000} minutes before the scan: ${recent.map((i) => `${i.version} (last edit ${i.lastEdited})`).join(', ')} (does not affect completeness; results describe this snapshot)` : ''}`,
      });
      for (const u of incompleteVs) incomplete.push(`${kind} ${s} ${u.version} is an incomplete draft (${u.reasons.join('; ')}): absences there are inconclusive and changes seen only there are provisional`);
    }
  sources.push({ source: 'Model', pinned: `baseline ${short(w.repo.baseline)}`, latest: `working tree${w.repo.head ? ` at ${short(w.repo.head)}` : ''}`, note: w.baseline ? (w.repo.modelDirty ? 'src/model has uncommitted changes' : 'src/model clean') : 'baseline model not loaded' });
  const archiveChanged = Object.entries(w.archiveRecorded).filter(([f, h]) => {
    const t = w.readFile(f);
    return t === null || sha256(t) !== h;
  });
  sources.push({ source: 'Source documents', pinned: `SOURCE_VERSIONS.md at baseline ${short(w.repo.baseline)}`, latest: 'working copy', note: `${Object.keys(w.archiveRecorded).length} files; ${archiveChanged.length ? `changed: ${archiveChanged.map(([f]) => f.split('/').pop()).join(', ')}` : 'all identical to the recorded hashes'}` });
  for (const [name, repo] of Object.entries(w.repos))
    sources.push({
      source: `git ${name}`,
      pinned: [...new Set(refs.flatMap((r) => { const p = parseRef(r.ref); return p && (p.scheme === 'code' || p.scheme === 'test') && p.repo === name ? [short(p.sha)] : []; }))].join(', '),
      latest: repo ? `HEAD ${short(repo.head)}` : 'unavailable',
      note: repo ? 'committed content only' : 'repository not on this machine',
    });
  sources.push({ source: 'Notion', pinned: 'facts recorded with their checked-at dates', latest: 'not read', note: 'offline report; see "Facts from services not read"' });
  sources.push({ source: 'Figma', pinned: 'frames as listed in the design maps', latest: 'not read', note: 'frame facts and replacements come from the design maps' });

  for (const r of refs) {
    if (r.integrity.status === 'unavailable' || r.later.status === 'unavailable') incomplete.push(`${r.ref}: ${r.integrity.status === 'unavailable' ? r.integrity.detail : r.later.detail}`);
    else if (r.integrity.status === 'differs' && r.integrity.precision === 'file') incomplete.push(`${r.ref}: only the containing file could be compared (${r.integrity.detail})`);
    if (r.later.status === 'inconclusive') incomplete.push(`${r.ref}: later-version comparison inconclusive (${r.later.detail})`);
  }
  if (!w.baseline) incomplete.push(`the model at baseline ${short(w.repo.baseline)} could not be loaded: model integrity and dependency checks were not made`);

  const rep: StalenessReport = {
    generatedAt: w.now,
    tool: opts.tool ?? 'scripts/trace-staleness.ts',
    status: 'Generated, read-only. "Needs review" is a prompt to look, not a finding that a relationship is wrong. Nothing in the trace, the model, the handoffs or any record was changed.',
    fingerprints: { traceData: opts.traceDataSha256 ?? '', model: modelFingerprint(Object.values(w.current.machines)), baselineCommit: w.repo.baseline },
    baseline: w.repo,
    scope: [...sources.filter((s) => s.source !== 'Notion' && s.source !== 'Figma').map((s) => `${s.source}: ${s.pinned || '—'} → ${s.latest}`), 'not read: Notion, Figma (their facts are shown with the dates they were last checked)'],
    sources,
    versions: versionInfos,
    inspection: { snapshotId: '', files: [], stable: true, changedDuringScan: [], attempts: 1 },
    refs,
    affected,
    externalFacts,
    incomplete,
    summary: {},
  };
  recount(rep);
  return rep;
}
