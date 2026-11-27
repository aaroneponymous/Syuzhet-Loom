// Fixture tests for the staleness report: each case is a small, controlled world.
//   npm run test:staleness
// In memory only; reads and writes no file.
import { final, initial, machine, s, t } from '../src/model/dsl';
import type { MachineDef } from '../src/model/types';
import { elementHash } from '../src/trace/hash';
import type { TraceData } from '../src/trace/types';
import { loomConfig } from '../loom.config';
import { applyInstability, computeStaleness, sha256, snapshotId, snapshotWorld, RECENT_EDIT_MS, type ModelSnapshot, type RefReport, type RepoView, type World } from './staleness-core';

// the workspace-relative folder names the report reads, from the configuration
const HO = loomConfig.handoffsDir;
const SP = loomConfig.specDir;

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

// ---- fixture model ----------------------------------------------------------------------------------
const fx = (): MachineDef =>
  machine({
    id: 'fx',
    title: 'Fixture',
    kind: 'shared',
    summary: 'A fixture component.',
    entries: { default: 'a' },
    states: [initial(), s('a', 'A', { rules: ['rule one'], refs: ['D-12'] }), final('b', 'B', { refs: ['D-12'] })],
    transitions: [t('start', 'a', 'Begin', { actor: 'user', flow: 'main' }), t('a', 'b', 'Go', { actor: 'user', flow: 'main', refs: ['D-12'] })],
  });
const parent = (): MachineDef =>
  machine({ id: 'host', title: 'Host', kind: 'journey', summary: 'Uses fx.', entries: { default: 'uses-fx' }, states: [initial(), s('uses-fx', 'Uses fx', { uses: 'fx' })], transitions: [t('start', 'uses-fx', 'In', { actor: 'user', flow: 'main' })] });
const snap = (m: MachineDef, h: MachineDef = parent()): ModelSnapshot => ({ machines: { fx: m, host: h }, scenarios: [], questions: [] });

// ---- fixture files ----------------------------------------------------------------------------------
const table = (rows: string[], header = '| Id | Action | Class |') => [header, header.replace(/[^|]+/g, '---'), ...rows].join('\n') + '\n';
const V2 = table(['| IX-01 | Go | confirmed |', '| IX-02 | Stay | confirmed |', '| IX-03 | Leave | confirmed |']);
const FILES: Record<string, string> = {
  [`${HO}/demo/v2/SCREEN_SPEC.md`]: V2,
  [`${HO}/demo/v3/SCREEN_SPEC.md`]: table(['| IX-01 | Go | confirmed |', '| IX-02 | Stay put | confirmed |', '| IX-03 | Leave | confirmed |']),
  [`${HO}/demo/v4/SCREEN_SPEC.md`]: table(['| IX-01 | Go | confirmed |', '| IX-02 | Stay put | derived |']),
  [`${HO}/demo/v4/CHANGES.md`]: table(['| IX-03 | withdrawn | Leave | — | decision |'], '| Id | Change | Before | After | Source |'),
  [`${HO}/demo/design/v2/DESIGN_MAP.md`]: table(['| IX-01 | Card | designed | [f](https://www.figma.com/design/KEY/x?node-id=1-1) |', '| IX-02 | Sheet | designed |'], '| Id | Surface | Status |'),
  [`${HO}/demo/design/v3/DESIGN_MAP.md`]: table(['| IX-01 | Card |  | designed |', '| IX-02 | Sheet | S | designed |'], '| Id | Surface | v3 | Status |'),
  [`${SP}/DECISION_REGISTER.md`]: '| D-12 | No double bookings. |\n',
};
// the rest of each version the handoff contract requires, so every fixture version is a complete draft
for (const v of ['v2', 'v3', 'v4']) {
  FILES[`${HO}/demo/${v}/HANDOFF.md`] = `# Demo\n\n| **Version** | ${v}, fixture |\n`;
  FILES[`${HO}/demo/${v}/WORKFLOWS.md`] = '# Workflows\n';
  FILES[`${HO}/demo/${v}/CHANGES.md`] ??= '# Changes\n';
}
for (const v of ['v2', 'v3']) {
  FILES[`${HO}/demo/design/${v}/DESIGN_MAP.md`] = `Handoff used: \`${HO}/demo/${v}/\`\n\n` + FILES[`${HO}/demo/design/${v}/DESIGN_MAP.md`];
  FILES[`${HO}/demo/design/${v}/FINDINGS.md`] = `Handoff used: \`${HO}/demo/${v}/\`\n`;
}

const NOW = Date.parse('2026-11-17T12:00:00.000Z');
const OLD = NOW - 24 * 3600 * 1000;
function world(opts: { files?: Record<string, string | null>; mtimes?: Record<string, number>; baseline?: ModelSnapshot | null; current?: ModelSnapshot; repo?: RepoView | null; currentSpec?: Record<string, string> } = {}): World {
  const files: Record<string, string> = Object.fromEntries(Object.entries({ ...FILES, ...(opts.files ?? {}) }).filter((e): e is [string, string] => e[1] !== null));
  return {
    now: new Date(NOW).toISOString(),
    scanStartedMs: NOW,
    stat: (rel) => (files[rel] !== undefined ? { mtimeMs: opts.mtimes?.[rel] ?? OLD } : null),
    readFile: (rel) => files[rel] ?? null,
    listDir: (rel) => {
      const kids = new Set<string>();
      for (const k of Object.keys(files)) if (k.startsWith(rel + '/')) kids.add(k.slice(rel.length + 1).split('/')[0]);
      return kids.size ? [...kids] : null;
    },
    archiveRecorded: { [`${SP}/DECISION_REGISTER.md`]: sha256(FILES[`${SP}/DECISION_REGISTER.md`]) },
    baseline: opts.baseline === undefined ? snap(fx()) : opts.baseline,
    current: opts.current ?? snap(fx()),
    repo: { baseline: 'a'.repeat(40), head: 'b'.repeat(40), modelDirty: false },
    specText: (id) => (id === 'D-12' ? 'No double bookings.' : undefined),
    currentSpecText: opts.currentSpec === undefined ? null : (id) => opts.currentSpec![id],
    repos: { 'demo-app': opts.repo === undefined ? null : opts.repo },
  };
}

const base = fx();
const H = (el?: string) => elementHash(base, el)!;
function data(over: Partial<TraceData> = {}): TraceData {
  return {
    version: 1,
    scope: 'fixture',
    status: 'fixture',
    baseline: { modelCommit: 'a'.repeat(40) },
    revisions: [
      { id: 'rev-model-baseline', source: 'model', version: 'a'.repeat(40), checkedAt: '2026-11-17', how: 'fixture' },
      { id: 'rev-h-v2', source: 'handoff', version: 'v2 SCREEN_SPEC.md', hash: sha256(V2), checkedAt: '2026-11-17', how: 'SHA-256 of the file' },
      { id: 'rev-d-v2', source: 'design', version: 'design/v2 DESIGN_MAP.md', hash: sha256(FILES[`${HO}/demo/design/v2/DESIGN_MAP.md`]), checkedAt: '2026-11-17', how: 'SHA-256 of the file' },
      { id: 'rev-git', source: 'git', version: 'abcdef1', checkedAt: '2026-11-17', how: 'fixture' },
      { id: 'rev-notion', source: 'notion', version: 'J01 v2', checkedAt: '2026-11-16', how: 'Notion fetch (fixture)' },
      { id: 'rev-arch', source: 'archive', version: 'DECISION_REGISTER.md', checkedAt: '2026-11-17', how: 'fixture' },
    ],
    records: [{ ref: 'notion:' + '0'.repeat(32), title: 'J01 review', rev: 'rev-notion', statuses: [{ kind: 'product-approval', value: 'Not started', heldIn: 'Notion', checkIn: 'external' }] }],
    links: [
      { id: 'L-001', type: 'refines', basis: 'stated', from: { ref: 'handoff:demo/v2#IX-01', rev: 'rev-h-v2' }, to: { ref: 'model:fx/a__b', rev: 'rev-model-baseline', elementHash: H('a__b') } },
      { id: 'L-002', type: 'refines', basis: 'stated', from: { ref: 'handoff:demo/v2#IX-02', rev: 'rev-h-v2' }, to: { ref: 'model:fx/b', rev: 'rev-model-baseline', elementHash: H('b') } },
      { id: 'L-003', type: 'refines', basis: 'stated', from: { ref: 'handoff:demo/v2#IX-03', rev: 'rev-h-v2' }, to: { ref: 'model:fx/a', rev: 'rev-model-baseline', elementHash: H('a') } },
      { id: 'L-004', type: 'designs', basis: 'stated', from: { ref: 'design-map:demo/v2#IX-01', rev: 'rev-d-v2' }, to: { ref: 'handoff:demo/v2#IX-01', rev: 'rev-h-v2' } },
      { id: 'L-005', type: 'designs', basis: 'stated', from: { ref: 'design-map:demo/v2#IX-02', rev: 'rev-d-v2' }, to: { ref: 'handoff:demo/v2#IX-02', rev: 'rev-h-v2' } },
      { id: 'L-006', type: 'designs', basis: 'stated', from: { ref: 'figma:KEY/1-1', rev: 'rev-d-v2' }, to: { ref: 'handoff:demo/v2#IX-01', rev: 'rev-h-v2' } },
      { id: 'L-007', type: 'evidences', basis: 'interpretation', note: 'fixture', from: { ref: 'code:demo-app@abcdef1:x.py#L1-L2', rev: 'rev-git' }, to: { ref: 'D-12', rev: 'rev-arch' } },
    ],
    gaps: [{ id: 'G-01', anchor: 'handoff:demo/v2#IX-03', expected: { layer: 'design', relationship: 'designs' }, kind: 'checked-absent', reason: 'fixture', checked: { source: 'fixture', rev: 'rev-d-v2' } }],
    scenarios: [],
    tests: [],
    runs: [],
    findings: [
      { id: 'XLF-01', title: 'about IX-02', targets: ['handoff:demo/v2#IX-02'], component: 'model:fx', kind: 'unstated', what: 'x', consequence: 'y', scenarios: [], at: ['rev-h-v2'], status: 'open', loggedBy: 'fixture', loggedAt: '2026-11-17' },
      { id: 'XLF-02', title: 'about IX-01', targets: ['handoff:demo/v2#IX-01'], component: 'model:fx', kind: 'unstated', what: 'x', consequence: 'y', scenarios: [], at: ['rev-h-v2'], status: 'open', loggedBy: 'fixture', loggedAt: '2026-11-17' },
    ],
    workItems: [{ id: 'WI-01', findings: ['XLF-01'], system: 'issue-tracker', state: 'draft', dedupeKey: 'k', title: 'x', body: 'y' }],
    ...over,
  };
}
const ref = (rep: ReturnType<typeof computeStaleness>, r: string): RefReport => rep.refs.find((x) => x.ref === r)!;
const affected = (rep: ReturnType<typeof computeStaleness>, id: string) => rep.affected.find((a) => a.id === id);

// 1. unchanged pinned content
{
  const rep = computeStaleness(data(), world());
  const r = ref(rep, 'handoff:demo/v2#IX-01');
  check('1. unchanged pinned file: resolves and matches its recorded revision', r.integrity.status === 'matches' && r.integrity.precision === 'file', r.integrity.detail);
  const a = ref(rep, 'model:fx/a__b');
  check('1. unchanged model element: recorded hash equals the element at the baseline', a.integrity.status === 'matches' && a.integrity.precision === 'item');
}

// 2. changed content at the same reference
{
  const edited = V2.replace('| IX-01 | Go |', '| IX-01 | Go now |');
  const rep = computeStaleness(data(), world({ files: { [`${HO}/demo/v2/SCREEN_SPEC.md`]: edited } }));
  const r = ref(rep, 'handoff:demo/v2#IX-01');
  check('2. pinned file changed in place: "differs" at file level, item effect stated as unknown', r.integrity.status === 'differs' && r.integrity.precision === 'file' && /unknown/.test(r.integrity.detail), r.integrity.detail);
  check('2. the same file change is listed as an incomplete comparison', rep.incomplete.some((i) => i.startsWith('handoff:demo/v2#IX-02') && /only the containing file/.test(i)));
  const d = data();
  d.links[0].to.elementHash = 'sha256:' + '0'.repeat(64);
  const rep2 = computeStaleness(d, world());
  check('2. model reference whose recorded hash is not the baseline element: "differs" at item level', ref(rep2, 'model:fx/a__b').integrity.status === 'differs' && ref(rep2, 'model:fx/a__b').integrity.precision === 'item');
  check('2. ... and the link is flagged "needs review"', affected(rep2, 'L-001')?.reasons.some((x) => x.kind === 'pinned-differs') === true);
}

// 3. newer version, unchanged item
{
  const rep = computeStaleness(data(), world());
  const r = ref(rep, 'handoff:demo/v2#IX-01');
  check('3. later versions exist and the item is identical: later-unchanged, pinned v2, latest v4', r.later.status === 'later-unchanged' && r.later.pinned === 'v2' && r.later.latest === 'v4');
  const d = ref(rep, 'design-map:demo/v2#IX-01');
  check('3. design row only gained an empty column: unchanged, with the layout change named', d.later.status === 'later-unchanged' && /gained empty column\(s\): "v3"/.test(d.later.detail), d.later.detail);
  check('3. nothing unchanged is flagged (L-004, XLF-02)', !affected(rep, 'L-004') && !affected(rep, 'XLF-02'));
}

// 4. newer version, changed or removed item
{
  const rep = computeStaleness(data(), world());
  const c = ref(rep, 'handoff:demo/v2#IX-02');
  check('4. changed item: status changed, first in v3, with a word diff', c.later.status === 'changed' && c.later.firstChangedIn === 'v3' && c.later.diff!.added.join(' ').includes('put'), JSON.stringify(c.later.diff));
  check('4. changed item: cell-level columns named ("Action", "Class")', /"Action" changed/.test(c.later.detail) && /"Class" changed/.test(c.later.detail), c.later.detail);
  const rm = ref(rep, 'handoff:demo/v2#IX-03');
  check('4. removed item: status removed, with the CHANGES.md row that declares it', rm.later.status === 'removed' && rm.later.steps.find((s) => s.version === 'v4')?.declared?.[0].includes('withdrawn') === true);
  const dm = ref(rep, 'design-map:demo/v2#IX-02');
  check('4. design row with a filled new column: changed, naming the new value', dm.later.status === 'changed' && /new "v3" = "S"/.test(dm.later.detail), dm.later.detail);
  const fg = ref(rep, 'figma:KEY/1-1');
  check('4. a frame no longer named in a complete design map: cannot match reliably, not "removed"', fg.later.status === 'unmatched' && /cannot be told without reading Figma/.test(fg.later.detail), fg.later.detail);
  const repl = computeStaleness(data(), world({ files: { [`${HO}/demo/design/v3/DESIGN_MAP.md`]: `Handoff used: \`${HO}/demo/v3/\`\n\n` + table(['| IX-01 | Card |  | designed |', '| IX-02 | Sheet | S | designed |', '| Card 1-1 | [2-2](https://www.figma.com/design/KEY/x?node-id=2-2) | stale – redesigned |'], '| Id | Surface | v3 | Status |') } }));
  const fr = ref(repl, 'figma:KEY/1-1');
  check('4. a frame named in a reconciliation row with a new link: changed (replaced), with the chain', fr.later.status === 'changed' && /v3: 1-1 → 2-2/.test(fr.later.detail), fr.later.detail);
  const carried = computeStaleness(data(), world({ files: { [`${HO}/demo/design/v3/DESIGN_MAP.md`]: FILES[`${HO}/demo/design/v3/DESIGN_MAP.md`] + '\nFigma file KEY. Carried frames, unchanged: Card 1-1, Sheet 3-3\n' } }));
  check('4. a frame listed by its bare id (e.g. "Carried frames") in a map for that file: unchanged, not "cannot match"', ref(carried, 'figma:KEY/1-1').later.status === 'later-unchanged', ref(carried, 'figma:KEY/1-1').later.detail);
  check('4. pinned references are reported as pinned, not migrated', rep.refs.filter((r) => r.ref.startsWith('handoff:')).every((r) => r.ref.includes('/v2#') && r.later.pinned === 'v2'));
}

// 5. unavailable source
{
  const rep = computeStaleness(data(), world({ repo: null }));
  const code = ref(rep, 'code:demo-app@abcdef1:x.py#L1-L2');
  check('5. missing repository: cannot check (unavailable), not "unresolved"', code.integrity.status === 'unavailable' && code.later.status === 'unavailable');
  const n = ref(rep, 'notion:' + '0'.repeat(32));
  check('5. Notion: unavailable, with its original checked-at date', n.integrity.status === 'unavailable' && /2026-11-16/.test(n.integrity.detail));
  check('5. the Notion fact is reported with checkedAt 2026-11-16 and "not re-checked"', rep.externalFacts.some((f) => f.checkedAt === '2026-11-16' && /Not re-checked/.test(f.note)));
  check('5. both are listed as incomplete', rep.incomplete.some((i) => i.startsWith('code:')) && rep.incomplete.some((i) => i.startsWith('notion:')));
  check('5. an unavailable source flags nothing as needing review', !affected(rep, 'L-007'));
  const repNoBase = computeStaleness(data(), world({ baseline: null }));
  check('5. baseline model not loadable: model checks unavailable and listed', ref(repNoBase, 'model:fx/a__b').integrity.status === 'unavailable' && repNoBase.incomplete.some((i) => /could not be loaded/.test(i)));
}

// 6. changed dependency, unchanged element body
{
  const cur = fx();
  cur.states.find((x) => x.id === 'a')!.rules = ['rule one, amended'];
  const rep = computeStaleness(data(), world({ current: snap(cur) }));
  const tr = ref(rep, 'model:fx/a__b');
  check('6. the transition body is unchanged (same element hash)', tr.later.status === 'later-unchanged' && elementHash(cur, 'a__b') === H('a__b'));
  check('6. ... but its from-state dependency is reported changed', tr.dependencies!.checked.some((d) => d.dependency === 'from-state: fx/a' && d.status === 'changed'));
  check('6. ... and the link is flagged through the dependency', affected(rep, 'L-001')?.reasons.some((r) => r.kind === 'dependency-changed') === true);
  check('6. unchecked dependencies are named explicitly', tr.dependencies!.unchecked.some((u) => /external service such as Notion/.test(u)) && tr.dependencies!.unchecked.length >= 3);

  const cur2 = fx();
  cur2.interpretations = ['a new machine-level rule'];
  const rep2 = computeStaleness(data(), world({ current: snap(cur2) }));
  check('6. a changed machine header flags its elements, whose bodies are unchanged', ref(rep2, 'model:fx/b').dependencies!.checked.some((d) => /machine rules and header: fx/.test(d.dependency) && d.status === 'changed'));

  const host = parent();
  host.states.find((x) => x.id === 'uses-fx')!.multiplicity = 'one per booking';
  const rep3 = computeStaleness(data(), world({ current: snap(fx(), host) }));
  check('6. a changed composite that stands for the component is a dependency', ref(rep3, 'model:fx/b').dependencies!.checked.some((d) => d.dependency === 'composite that stands for this component: host/uses-fx' && d.status === 'changed'));

  const rep4 = computeStaleness(data(), world({ files: { [`${SP}/DECISION_REGISTER.md`]: '| D-12 | No double bookings, ever. |\n' } }));
  const rep5 = computeStaleness(data(), world({ files: { [`${SP}/DECISION_REGISTER.md`]: '| D-12 | **No** double bookings. |\n' }, currentSpec: { 'D-12': 'No double bookings.' } }));
  check('6. archive file reformatted, extraction regenerated and identical: no dependency change', ref(rep5, 'model:fx/a__b').dependencies!.checked.some((d) => /archive wording of cited ids/.test(d.dependency) && d.status === 'unchanged' && /identical to the baseline extraction/.test(d.detail ?? '')));
  const rep6 = computeStaleness(data(), world({ files: { [`${SP}/DECISION_REGISTER.md`]: '| D-12 | *(Amended.)* No double bookings. |\n' }, currentSpec: { 'D-12': '*(Amended.)* No double bookings.' } }));
  check('6. extraction regenerated with a note added to the id: dependency changed, even though the old wording still appears', ref(rep6, 'model:fx/a__b').dependencies!.checked.some((d) => /archive wording of cited ids/.test(d.dependency) && d.status === 'changed' && /differs from the baseline extraction for D-12/.test(d.detail ?? '')));
  check('6. a cited decision whose archive wording changed is a dependency change', ref(rep4, 'model:fx/a__b').dependencies!.checked.some((d) => /archive wording of cited ids/.test(d.dependency) && d.status === 'changed' && /D-12/.test(d.detail ?? '')));
}

// 7. draft completeness, judged separately from time since the last edit
{
  check('7. every fixture version is a complete draft', computeStaleness(data(), world()).versions.every((v) => v.complete && !v.reasons.length));

  // a recent edit alone does not make a version incomplete: the result stands, and the edit is reported beside it
  const rep = computeStaleness(data(), world({ mtimes: { [`${HO}/demo/design/v3/DESIGN_MAP.md`]: NOW - 60 * 1000 } }));
  const fg = ref(rep, 'figma:KEY/1-1');
  const dv3 = rep.versions.find((v) => v.source === 'design demo' && v.version === 'v3')!;
  check('7. edited one minute before the scan, but complete: still complete', dv3.complete && dv3.recentlyEdited && dv3.lastEdited === new Date(NOW - 60 * 1000).toISOString());
  check('7. ... so the frame it no longer names is "cannot match", not provisional', fg.later.status === 'unmatched' && !fg.later.provisional, `${fg.later.status}: ${fg.later.provisional}`);
  check(`7. ... and the recent edit is stated in the sources (within ${RECENT_EDIT_MS / 60000} minutes; does not affect completeness)`, rep.sources.some((x) => x.source === 'design demo' && /edited within 15 minutes before the scan: v3 .*does not affect completeness/.test(x.note)));
  check('7. ... and is not listed as an incomplete comparison', !rep.incomplete.some((i) => /design demo v3/.test(i)));

  // an old but incomplete draft: a required file is missing
  const rep1 = computeStaleness(data(), world({ files: { [`${HO}/demo/design/v3/FINDINGS.md`]: null } }));
  const fg1 = ref(rep1, 'figma:KEY/1-1');
  check('7. a design version missing a required file is incomplete, however old', rep1.versions.some((v) => v.source === 'design demo' && v.version === 'v3' && !v.complete && !v.recentlyEdited && /missing FINDINGS\.md, required by the handoff contract/.test(v.reasons.join(' '))));
  check('7. a frame absent from an incomplete design version: inconclusive, not removed', fg1.later.status === 'inconclusive' && !!fg1.later.provisional, `${fg1.later.status}: ${fg1.later.detail}`);
  check('7. the incomplete version is named in the incomplete list', rep1.incomplete.some((i) => /design demo v3 is an incomplete draft/.test(i)));
  check('7. an inconclusive frame flags nothing as needing review', !affected(rep1, 'L-006'));

  // other content signs of an unfinished draft
  const repH = computeStaleness(data(), world({ files: { [`${HO}/demo/v4/HANDOFF.md`]: '# Demo\n\n| **Version** | v3, copied |\n' } }));
  check('7. a HANDOFF.md whose "Version" row does not name its folder: incomplete', repH.versions.some((v) => v.version === 'v4' && v.source === 'handoff demo' && !v.complete && /no "Version" row naming v4/.test(v.reasons.join(' '))));
  const repE = computeStaleness(data(), world({ files: { [`${HO}/demo/v4/WORKFLOWS.md`]: '  \n' } }));
  check('7. an empty file: incomplete', repE.versions.some((v) => v.version === 'v4' && v.source === 'handoff demo' && !v.complete && /empty: WORKFLOWS\.md/.test(v.reasons.join(' '))));
  const repD = computeStaleness(data(), world({ files: { [`${HO}/demo/design/v3/DESIGN_MAP.md`]: FILES[`${HO}/demo/design/v3/DESIGN_MAP.md`].replace('demo/v3/', 'demo/v2/') } }));
  check('7. a design map naming a different handoff version: incomplete', repD.versions.some((v) => v.source === 'design demo' && v.version === 'v3' && !v.complete && /no "Handoff used" naming handoff v3/.test(v.reasons.join(' '))));

  // v4 missing a file v3 had: incomplete. IX-03 is absent there, so the removal is inconclusive and the status rests on complete v3
  const rep2 = computeStaleness(data(), world({ files: { [`${HO}/demo/v3/NOTES.md`]: '# notes\n', [`${HO}/demo/v4/CHANGES.md`]: null } }));
  const ix3 = ref(rep2, 'handoff:demo/v2#IX-03');
  check('7. a version missing files is incomplete, naming both reasons', rep2.versions.some((v) => v.source === 'handoff demo' && v.version === 'v4' && !v.complete && /missing CHANGES\.md, required/.test(v.reasons[0]) && /missing NOTES\.md, which v3 has/.test(v.reasons[1])));
  check('7. absent only in the incomplete version: status from the complete version, removal provisional', ix3.later.status === 'later-unchanged' && ix3.later.basedOn === 'v3' && /there it is inconclusive/.test(ix3.later.provisional ?? ''), `${ix3.later.status} ${ix3.later.basedOn} ${ix3.later.provisional}`);
  check('7. so the gap anchored on it is not flagged', !affected(rep2, 'G-01'));
}

// 8. a source that changes during the scan
{
  let reads = 0;
  const base = world();
  const flaky: World = { ...base, readFile: (rel) => (rel === `${HO}/demo/v4/SCREEN_SPEC.md` && ++reads > 1 ? FILES[rel] + '| IX-09 | new | x |\n' : base.readFile(rel)) };
  const sw = snapshotWorld(flaky);
  const rep = computeStaleness(data(), sw);
  const consistent = reads === 1;
  const changed = sw.recheck();
  applyInstability(rep, changed, 3);
  check('8. within one scan, a file is read once (no mixing of two states)', consistent, `reads during scan: ${reads}`);
  check('8. the change is detected on re-check', changed.includes(`${HO}/demo/v4/SCREEN_SPEC.md`));
  check('8. the snapshot is reported unstable, with the file named', !rep.inspection.stable && /UNSTABLE SNAPSHOT/.test(rep.incomplete[0]) && rep.inspection.attempts === 3);
  check('8. comparisons that read the changed file become inconclusive', ref(rep, 'handoff:demo/v2#IX-02').later.status === 'inconclusive');
  check('8. ... and no longer raise later-version flags', !affected(rep, 'XLF-01') && !affected(rep, 'WI-01'));
  check('8. comparisons that did not read it are unaffected', ref(rep, 'design-map:demo/v2#IX-02').later.status === 'changed');
  rep.inspection.files = sw.inspected();
  const id1 = snapshotId(rep);
  check('8. the snapshot id is stable for the same inputs and changes when an input changes', /^snap-[0-9a-f]{12}$/.test(id1) && id1 === snapshotId(rep) && id1 !== snapshotId({ ...rep, inspection: { ...rep.inspection, files: rep.inspection.files.map((f, i) => (i ? f : { ...f, sha256: '0'.repeat(64) })) } }), id1);
  check('8. inspected files are listed with hash and modification time', sw.inspected().some((f) => f.path === `${HO}/demo/v2/SCREEN_SPEC.md` && f.sha256 === sha256(V2) && !!f.mtime));
}

// impact paths and read-only behaviour
{
  const d = data();
  const before = JSON.stringify(d);
  const rep = computeStaleness(d, world());
  check('impact: finding on a changed item needs review, with its path', affected(rep, 'XLF-01')?.reasons[0].path.startsWith('XLF-01 ← handoff:demo/v2#IX-02') === true);
  check('impact: work item needs review through its finding', affected(rep, 'WI-01')?.reasons[0].path.startsWith('WI-01 ← XLF-01 ← ') === true);
  check('impact: gap anchored on a removed item needs review', affected(rep, 'G-01')?.reasons.some((r) => r.kind === 'later-removed') === true);
  check('impact: every flag is labelled "needs review"', rep.affected.every((a) => a.label === 'needs review'));
  check('impact: finding and work-item states are reported unchanged', /status stays "open"/.test(affected(rep, 'XLF-01')!.summary) && /state stays "draft"/.test(affected(rep, 'WI-01')!.summary));
  check('read-only: the trace data is not modified', JSON.stringify(d) === before);
  check('fingerprints: trace data and model are recorded', computeStaleness(d, world(), { traceDataSha256: 'sha256:x' }).fingerprints.traceData === 'sha256:x' && /^sha256:[0-9a-f]{64}$/.test(rep.fingerprints.model));
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall staleness checks passed');
process.exit(failed ? 1 : 0);
