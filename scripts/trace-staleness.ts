// Generates the trace staleness report from local sources only. Read-only towards every source;
// writes only the report folder (default trace-reports/): STALENESS.md and staleness.json.
//   npm run trace-staleness [-- --candidates IX-06,SR-03] [--trace trace/other.json --out trace-reports/other]
// --candidates adds a section that spells out those handoff ids one by one.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { machines, openQuestions, scenarios } from '../src/model';
import { parseRef } from '../src/trace/refs';
import { modelAt } from './pinned-model';
import type { TraceData } from '../src/trace/types';
import { applyInstability, computeStaleness, RECENT_EDIT_MS, sha256, snapshotId, snapshotWorld, type ModelSnapshot, type RefReport, type RepoView, type StalenessReport, type World } from './staleness-core';

import { REPO_DIR, REPORT_DIR, SPEC, TRACE_FILE as DEFAULT_TRACE_FILE, WORKSPACE, repoCandidates } from './workspace';

const git = (dir: string, args: string[]): string | null => {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 });
  } catch {
    return null;
  }
};

/** Another repository named in code: or test: references, found in the configured folders; the one that holds a pinned commit wins. */
function repoView(name: string, shas: string[]): RepoView | null {
  const candidates = repoCandidates(name);
  const dir = candidates.find((d) => shas.some((sha) => git(d, ['cat-file', '-e', `${sha}^{commit}`]) !== null)) ?? candidates[0];
  if (!dir) return null;
  const head = git(dir, ['rev-parse', 'HEAD'])?.trim();
  if (!head) return null;
  return {
    head,
    commitExists: (sha) => git(dir, ['cat-file', '-e', `${sha}^{commit}`]) !== null,
    show: (sha, path) => git(dir, ['show', `${sha}:${path}`]),
    blob: (sha, path) => git(dir, ['rev-parse', `${sha}:${path}`])?.trim() ?? null,
    dirty: (path) => !!git(dir, ['status', '--porcelain', '--', path])?.trim(),
  };
}

/** Archive files and hashes recorded in SOURCE_VERSIONS.md. */
// The manifest and the extracted wording as they were at the trace's baseline commit, so that a manifest or
// extraction regenerated after the pins were made cannot hide an archive change.
function atBaseline(rel: string): string {
  const t = git(REPO_DIR, ['show', `${data.baseline.modelCommit}:${rel}`]);
  if (t === null) throw new Error(`cannot read ${rel} at the baseline commit ${data.baseline.modelCommit}`);
  return t;
}
function archiveRecorded(): Record<string, string> {
  const md = atBaseline('SOURCE_VERSIONS.md');
  const out: Record<string, string> = {};
  for (const m of md.matchAll(/^\| `([^`]+\.md)` \| `([0-9a-f]{64})` \|/gm)) out[`${SPEC}/${m[1]}`] = m[2];
  return out;
}

// ---- Markdown -----------------------------------------------------------------------------------------
const clip = (s: string, n = 280) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function diffLines(r: RefReport, max = 10): string[] {
  const d = r.later.diff;
  if (!d) return [];
  const out: string[] = [];
  for (const x of d.removed.slice(0, max)) out.push(`  - − \`${esc(clip(x))}\``);
  for (const x of d.added.slice(0, max)) out.push(`  - + \`${esc(clip(x))}\``);
  const more = d.removed.length + d.added.length - Math.min(d.removed.length, max) - Math.min(d.added.length, max);
  if (more > 0) out.push(`  - … ${more} more segment(s) in staleness.json`);
  return out;
}

function laterBlock(r: RefReport): string[] {
  const out = [`- **${r.ref}**: pinned **${r.later.pinned}**, latest inspected **${r.later.latest}**${r.later.basedOn ? ` (status based on complete **${r.later.basedOn}**)` : ''}: **${r.later.status}**. ${r.later.detail}`];
  if (r.later.provisional) out.push(`  - provisional: ${r.later.provisional}`);
  for (const s of r.later.steps) {
    out.push(`  - ${s.version}${s.complete ? '' : ' (incomplete draft)'}: ${s.status}${s.note ? `; ${esc(clip(s.note, 220))}` : ''}${s.declared ? `; ${s.version}/CHANGES.md: ${s.declared.map((d) => `\`${esc(clip(d, 200))}\``).join(' ')}` : ''}`);
  }
  out.push(...diffLines(r));
  out.push(`  - used by: ${r.usedBy.join(', ')}`);
  return out;
}

function toMarkdown(rep: StalenessReport, candidates: string[]): string {
  const L: string[] = [];
  L.push('# Trace staleness report', '');
  L.push(`Generated **${rep.generatedAt}** by \`${rep.tool}\`. Snapshot **\`${rep.inspection.snapshotId}\`**. ${rep.status}`, '');
  L.push('This report compares local files and commits only. It is not a fresh check of any external service (Notion, Figma).', '');

  L.push('## Summary', '', '| Measure | Count |', '|---|---|');
  for (const [k, v] of Object.entries(rep.summary)) L.push(`| ${k} | ${v} |`);
  L.push('');

  L.push('## Sources examined', '', '| Source | Pinned | Latest inspected | Note |', '|---|---|---|---|');
  for (const s of rep.sources) L.push(`| ${s.source} | ${esc(s.pinned || '—')} | ${esc(s.latest)} | ${esc(s.note)} |`);
  L.push('');

  L.push('## Comparison scope', '');
  for (const x of rep.scope) L.push(`- ${esc(x)}`);
  L.push('');

  L.push('## Inspection', '');
  L.push(`Snapshot: **${rep.inspection.stable ? 'stable' : 'UNSTABLE'}** (attempts: ${rep.inspection.attempts}). ${rep.inspection.stable ? 'Every inspected file read the same at the end of the scan as when it was first read.' : `Changed during the scan: ${rep.inspection.changedDuringScan.join(', ')}. Comparisons that read them are marked inconclusive.`}`, '');
  L.push(`Trace data fingerprint \`${rep.fingerprints.traceData.slice(0, 19)}…\`; model fingerprint \`${rep.fingerprints.model.slice(0, 19)}…\`; baseline \`${rep.fingerprints.baselineCommit.slice(0, 7)}\`.`, '');
  L.push(`Snapshot id \`${rep.inspection.snapshotId}\`: a hash of every inspected file's path and content, the model and trace-data fingerprints and the repository commit. A report with the same id compared exactly the same inputs.`, '');
  L.push(`Draft completeness is judged from content (required files, files the previous version had, no empty file, a header naming the version). Time since the last edit is shown separately; an edit within ${RECENT_EDIT_MS / 60000} minutes is noted but does not make a version incomplete.`, '');
  L.push('| Version | Complete draft | Why not complete | Last edited | Edited recently | Files |', '|---|---|---|---|---|---|');
  for (const v of rep.versions) L.push(`| ${v.source} ${v.version} | ${v.complete ? 'yes' : '**no**'} | ${esc(v.reasons.join('; ')) || '—'} | ${v.lastEdited ?? '—'} | ${v.recentlyEdited ? 'yes' : 'no'} | ${v.files.join(', ')} |`);
  L.push('', `<details><summary>${rep.inspection.files.length} files inspected (path, SHA-256, modified)</summary>`, '', '| File | SHA-256 | Modified |', '|---|---|---|');
  for (const f of rep.inspection.files) L.push(`| ${f.path} | ${f.sha256 ? f.sha256.slice(0, 16) + '…' : 'absent'} | ${f.mtime ?? '—'} |`);
  L.push('', '</details>', '');

  if (candidates.length) {
    L.push('## Requested candidates', '');
    for (const c of candidates) {
      const hits = rep.refs.filter((r) => r.ref.endsWith(`#${c}`));
      if (!hits.length) L.push(`- **${c}**: not referenced by the trace.`);
      for (const r of hits) L.push(...laterBlock(r), `  - pinned reference: ${r.integrity.status} (${r.integrity.precision}). ${r.integrity.detail}`);
    }
    L.push('');
  }

  L.push('## Pinned-reference problems', '');
  const problems = rep.refs.filter((r) => r.integrity.status === 'differs' || r.integrity.status === 'unresolved');
  if (!problems.length) L.push('None. Every checkable pinned reference resolves and matches its recorded revision. References that could not be checked are listed under "Unavailable sources and incomplete comparisons".');
  for (const r of problems) L.push(`- **${r.ref}**: ${r.integrity.status} (compared at ${r.integrity.precision} level). ${r.integrity.detail}`);
  L.push('');

  L.push('## Later-version changes', '');
  const changed = rep.refs.filter((r) => ['changed', 'removed', 'unmatched'].includes(r.later.status));
  if (!changed.length) L.push('None found.');
  for (const r of changed) L.push(...laterBlock(r));
  const unchanged = rep.refs.filter((r) => r.later.status === 'later-unchanged');
  if (unchanged.length) L.push('', `**Later version exists, item unchanged (${unchanged.length}):** ${unchanged.map((r) => `${r.ref} (${r.later.pinned} → ${r.later.latest})`).join('; ')}`);
  L.push('');

  L.push('## Dependencies the element hash does not cover', '');
  const modelRefs = rep.refs.filter((r) => r.dependencies);
  const depChanged = modelRefs.filter((r) => r.dependencies!.checked.some((d) => d.status === 'changed' || d.status === 'removed'));
  if (!depChanged.length) L.push(`No recorded dependency changed for the ${modelRefs.length} Model references checked.`);
  for (const r of depChanged) for (const d of r.dependencies!.checked.filter((x) => x.status !== 'unchanged')) L.push(`- **${r.ref}**: ${d.dependency}: ${d.status}${d.detail ? `. ${d.detail}` : ''}`);
  const kinds = [...new Set(modelRefs.flatMap((r) => r.dependencies!.checked.map((d) => d.dependency.split(':')[0].replace(/\s*\(\d+\)$/, ''))))];
  L.push('', `Checked for each model reference, baseline → working tree: ${kinds.join('; ')}.`);
  L.push('', `Not checked: ${modelRefs[0]?.dependencies?.unchecked.join('; ') ?? 'n/a'}.`, '');

  L.push('## Potentially affected (needs review)', '');
  L.push('Each entry is a prompt to look again, with the path that led here. None says the relationship is wrong, and none was changed.', '');
  const subjects: [string, string][] = [['finding', 'Findings'], ['work-item', 'Work items'], ['gap', 'Coverage gaps'], ['record', 'Status records'], ['link', 'Links']];
  for (const [s, title] of subjects) {
    const items = rep.affected.filter((a) => a.subject === s);
    L.push(`### ${title} (${items.length})`, '');
    if (!items.length) L.push('None.', '');
    for (const a of items) {
      L.push(`- **${a.id}**: needs review. ${esc(clip(a.summary, 240))}`);
      for (const r of a.reasons.slice(0, 4)) L.push(`  - ${esc(clip(r.path, 300))}`);
      if (a.reasons.length > 4) L.push(`  - … ${a.reasons.length - 4} more`);
    }
    L.push('');
  }

  L.push('## Facts from services not read by this report', '', '| Reference | Fact as recorded | Checked at | Note |', '|---|---|---|---|');
  for (const f of rep.externalFacts) L.push(`| ${f.ref} | ${esc(f.fact)} | ${f.checkedAt} | ${esc(f.note)} |`);
  L.push('');

  L.push('## Unavailable sources and incomplete comparisons', '');
  if (!rep.incomplete.length) L.push('None.');
  for (const i of rep.incomplete) L.push(`- ${esc(i)}`);
  L.push('');

  L.push('## Method and limits', '');
  L.push('- **Pinned integrity:**');
  L.push('  - Handoff and design items are compared through the recorded file hash. If the file is identical, the item is identical. If it differs, the item-level effect is unknown, because no item fingerprint was recorded.');
  L.push('  - Model elements are compared by element hash against the model loaded from the baseline commit.');
  L.push('  - Code and tests are content-addressed by commit.');
  L.push('- **Later versions:** every version folder after the pinned one is read, and the item\'s text (its rows or headed section in its defining file, `SCREEN_SPEC.md`, `WORKFLOWS.md` or `DESIGN_MAP.md`) is compared exactly. Rows naming the id in a later `CHANGES.md` are shown as declared changes. Where the same id matches a different number of rows, the item is reported as "cannot match".');
  L.push('- **Element hashes** cover one element\'s own definition. The dependencies listed above are compared separately; everything under "Not checked" is not.');
  L.push(`- Nothing was migrated, refreshed or resolved: pinned references, recorded revisions, findings, gaps and statuses are exactly as in \`${TRACE_FILE}\`.`);
  return L.join('\n') + '\n';
}

// ---- main ---------------------------------------------------------------------------------------------
const args = process.argv.slice(2);
const ci = args.indexOf('--candidates');
const candidates = ci >= 0 ? (args[ci + 1] ?? '').split(',').filter(Boolean) : [];
const opt = (name: string, dflt: string) => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : dflt);
const TRACE_FILE = opt('--trace', DEFAULT_TRACE_FILE);
const OUT_DIR = join(REPO_DIR, opt('--out', REPORT_DIR));
const traceRaw = readFileSync(join(REPO_DIR, TRACE_FILE), 'utf8');
const data = JSON.parse(traceRaw) as TraceData;
const repoRefs = [...data.links.flatMap((l) => [l.from.ref, l.to.ref]), ...data.tests.map((t) => t.ref)].flatMap((r) => { const p = parseRef(r); return p && (p.scheme === 'code' || p.scheme === 'test') ? [p] : []; });
const repoNames = [...new Set(repoRefs.map((p) => p.repo))];

// The current extraction is used only if the current manifest's hashes match the current archive files, i.e.
// extract-sources was re-run on exactly this archive.
function currentExtraction(): ((id: string) => string | undefined) | null {
  const md = readFileSync(join(REPO_DIR, 'SOURCE_VERSIONS.md'), 'utf8');
  const entries = [...md.matchAll(/^\| `([^`]+\.md)` \| `([0-9a-f]{64})` \|/gm)];
  const fresh = entries.length > 0 && entries.every((m) => { const f = join(WORKSPACE, SPEC, m[1]); return existsSync(f) && sha256(readFileSync(f, 'utf8')) === m[2]; });
  if (!fresh) return null;
  const cur = JSON.parse(readFileSync(join(REPO_DIR, 'src/model/generated/sources.json'), 'utf8')) as { refs: Record<string, { text?: string }> };
  return (id) => cur.refs[id]?.text;
}
const baselineSources = JSON.parse(atBaseline('src/model/generated/sources.json')) as { refs: Record<string, { text?: string }> };
const scanStarted = Date.now();
const world: World = {
  now: new Date(scanStarted).toISOString(),
  scanStartedMs: scanStarted,
  stat: (rel) => {
    const p = join(WORKSPACE, rel);
    return existsSync(p) ? { mtimeMs: statSync(p).mtimeMs } : null;
  },
  readFile: (rel) => {
    const p = join(WORKSPACE, rel);
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
  },
  listDir: (rel) => {
    const p = join(WORKSPACE, rel);
    return existsSync(p) ? readdirSync(p) : null;
  },
  archiveRecorded: archiveRecorded(),
  baseline: await modelAt(REPO_DIR, data.baseline.modelCommit),
  current: { machines, scenarios, questions: openQuestions },
  repo: {
    baseline: data.baseline.modelCommit,
    head: git(REPO_DIR, ['rev-parse', 'HEAD'])?.trim() ?? null,
    modelDirty: (() => { const s = git(REPO_DIR, ['status', '--porcelain', '--', 'src/model']); return s === null ? null : !!s.trim(); })(),
  },
  specText: (id) => baselineSources.refs[id]?.text,
  currentSpecText: currentExtraction(),
  repos: Object.fromEntries(repoNames.map((n) => [n, repoView(n, repoRefs.filter((p) => p.repo === n).map((p) => p.sha))])),
};

// Scan against a snapshot that reads each file once; re-read everything afterwards. If anything changed
// during the scan, try again (up to three times); if it keeps changing, report the snapshot as unstable.
let report: StalenessReport | null = null;
for (let attempt = 1; attempt <= 3; attempt++) {
  const sw = snapshotWorld({ ...world, now: new Date().toISOString(), scanStartedMs: Date.now() });
  const r = computeStaleness(data, sw, { traceDataSha256: `sha256:${sha256(traceRaw)}` });
  // inputs read outside the snapshot world: the manifest and extraction (current and at the baseline commit)
  const direct = ['SOURCE_VERSIONS.md', 'src/model/generated/sources.json'].map((rel) => {
    const f = join(REPO_DIR, rel);
    return { path: `model:${rel}`, sha256: existsSync(f) ? sha256(readFileSync(f, 'utf8')) : null, mtime: existsSync(f) ? new Date(statSync(f).mtimeMs).toISOString() : null };
  });
  const atBase = ['SOURCE_VERSIONS.md', 'src/model/generated/sources.json'].map((rel) => ({ path: `repo@${data.baseline.modelCommit.slice(0, 7)}:${rel}`, sha256: sha256(atBaseline(rel)), mtime: null }));
  r.inspection.files = [...sw.inspected(), ...direct, ...atBase].sort((a, b) => a.path.localeCompare(b.path));
  const changed = sw.recheck();
  report = applyInstability(r, changed, attempt);
  report.inspection.snapshotId = snapshotId(report);
  if (!changed.length) break;
}
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'staleness.json'), JSON.stringify(report, null, 2) + '\n');
writeFileSync(join(OUT_DIR, 'STALENESS.md'), toMarkdown(report!, candidates));
console.log(`snapshot ${report!.inspection.snapshotId}: ${report!.inspection.stable ? 'stable' : 'UNSTABLE'} after ${report!.inspection.attempts} attempt(s); ${report!.inspection.files.length} files inspected`);
for (const [k, v] of Object.entries(report!.summary)) console.log(`${k.padEnd(28)} ${v}`);
console.log(`read ${TRACE_FILE}; wrote ${OUT_DIR.slice(REPO_DIR.length + 1)}/STALENESS.md and staleness.json`);
