// Self-test for the trace: invalid references and records are rejected, and element hashes are stable.
//   npm run test:trace
// Works on in-memory copies of the bundled example trace. Writes nothing in this repository; the cases about
// code: and test: references need another git repository, so one small fixture repository is created in the
// system temporary folder and removed at the end.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { machineList, machines } from '../src/model';
import type { MachineDef } from '../src/model/types';
import { canonicalJson, elementHash, elementPayload, sha256Hex } from '../src/trace/hash';
import { pinnedPath } from '../src/trace/refs';
import type { TraceData } from '../src/trace/types';
import { modelAt } from './pinned-model';
import { resolveRef, validateTrace } from './validate-trace';
import { REPO_DIR, HANDOFFS, TRACE_FILE } from './workspace';

// The example trace, the component it traces, and one of its handoff slices: the cases below are written
// against these, so they follow the bundled example.
const base = JSON.parse(readFileSync(join(REPO_DIR, TRACE_FILE), 'utf8')) as TraceData;
const M = 'booking-hold';
const SLICE = 'room-booking';

// ---- a fixture repository for code: and test: references -------------------------------------------
// The example has no code, so its trace has no code or test reference. These cases add one of each to a
// copy of the trace, pointing into a repository made here. validate-trace finds it through LOOM_REPO_DIRS.
const fixtureRoot = mkdtempSync(join(tmpdir(), 'loom-selftest-'));
const FIXTURE_REPO = 'fixture-service';
const fixtureSha = (() => {
  const dir = join(fixtureRoot, FIXTURE_REPO);
  mkdirSync(join(dir, 'tests'), { recursive: true });
  writeFileSync(join(dir, 'holds.py'), 'def place_hold(room, period, person):\n    if room.is_held(period):\n        return None\n    return room.hold(period, person)\n');
  writeFileSync(join(dir, 'tests/test_holds.py'), 'def test_second_hold_is_refused():\n    assert place_hold(ROOM, PERIOD, "b") is None\n');
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  return git('rev-parse', 'HEAD').trim();
})();
process.env.LOOM_REPO_DIRS = fixtureRoot;
const CODE_REF = `code:${FIXTURE_REPO}@${fixtureSha.slice(0, 7)}:holds.py#L1-L4`;
const TEST_REF = `test:${FIXTURE_REPO}@${fixtureSha.slice(0, 7)}:tests/test_holds.py::test_second_hold_is_refused`;
/** The example trace plus one evidence link and one test definition into the fixture repository. */
const withCode = (d: TraceData): TraceData => {
  d.revisions.push({ id: 'rev-git-fixture', source: 'git', version: fixtureSha, checkedAt: '2026-11-27', how: 'fixture repository made by the self-test' });
  d.links.push({ id: 'L-900', type: 'evidences', basis: 'interpretation', note: 'fixture: code that refuses a second hold', from: { ref: CODE_REF, rev: 'rev-git-fixture' }, to: { ref: 'AF-01', rev: 'rev-spec-follow-ups' } });
  d.links.push({ id: 'L-901', type: 'tests', basis: 'interpretation', note: 'fixture', from: { ref: TEST_REF, rev: 'rev-git-fixture' }, to: { ref: CODE_REF, rev: 'rev-git-fixture' } });
  d.tests.push({ ref: TEST_REF, title: 'second hold is refused', rev: 'rev-git-fixture' });
  return d;
};
const clone = (): TraceData => withCode(structuredClone(base));
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

// ---- the example data is valid --------------------------------------------------------------------
const ok = validateTrace(base, { checkBaselineDiff: false });
check('example data validates', ok.errors.length === 0, ok.errors.slice(0, 3).join('; '));
{
  const r = validateTrace(clone(), { checkBaselineDiff: false });
  check('example data plus a code and a test reference into the fixture repository validates, with nothing left unchecked', r.errors.length === 0 && !r.warnings.some((w) => /not on this machine/.test(w)), [...r.errors, ...r.warnings].slice(0, 3).join('; '));
}

// ---- invalid data is rejected ----------------------------------------------------------------------
const rejects = (name: string, mutate: (d: TraceData) => void, expect: RegExp) => {
  const d = clone();
  mutate(d);
  const r = validateTrace(d, { checkBaselineDiff: false });
  const hit = r.errors.find((e) => expect.test(e));
  check(`rejects: ${name}`, !!hit, hit ?? `no error matching ${expect}; got ${r.errors.length} other error(s): ${r.errors.slice(0, 2).join(' | ')}`);
};
const firstLink = (d: TraceData, type: string) => d.links.find((l) => l.type === type)!;

rejects('unknown model element', (d) => (firstLink(d, 'refines').to.ref = `model:${M}/no-such-state`), /no state or transition "no-such-state"/);
rejects('unknown model machine', (d) => (firstLink(d, 'refines').to.ref = 'model:no-such-machine/held'), /no machine "no-such-machine"/);
rejects('unknown spec id', (d) => (firstLink(d, 'allocates-to').to.ref = 'AF-99'), /AF-99: no such id/);
rejects('unrecognised reference form', (d) => (d.findings[0].targets[0] = `${M}/held`), /unrecognised reference/);
rejects('handoff version that does not exist (v99)', (d) => (firstLink(d, 'refines').from.ref = `handoff:${SLICE}/v99#IX-05`), /v99\/ does not exist/);
rejects('handoff id absent from its pinned version (IX-08 is new in v2)', (d) => (firstLink(d, 'refines').from.ref = `handoff:${SLICE}/v1#IX-08`), new RegExp(`IX-08 is not a row or heading in ${HANDOFFS}/${SLICE}/v1`));
rejects('design-map row that does not exist', (d) => (firstLink(d, 'designs').from.ref = `design-map:${SLICE}/v1#IX-99`), /IX-99 has no row/);
// the example design map links no frame, so this case adds a frame link instead of editing one
rejects('figma frame not listed in any design map', (d) => d.links.push({ id: 'L-902', type: 'designs', basis: 'interpretation', note: 'fixture', from: { ref: 'figma:FIXTUREKEY/99-9999', rev: 'rev-design-v1' }, to: firstLink(d, 'refines').from }), /frame 99-9999 is not listed/);
rejects('code line range past the end of the file', (d) => (firstLink(d, 'evidences').from.ref = firstLink(d, 'evidences').from.ref.replace(/#L\d+-L\d+/, '#L1-L999999')), /past the end of the file/);
rejects('code at a commit that does not exist', (d) => (firstLink(d, 'evidences').from.ref = firstLink(d, 'evidences').from.ref.replace(/@[0-9a-f]+:/, '@deadbee:')), /commit deadbee not found/);
rejects('test name that does not exist', (d) => (d.tests[0].ref = d.tests[0].ref.replace(/::\w+$/, '::test_nothing_like_this')), /no test named test_nothing_like_this/);
rejects('stated refines whose row does not mention the element', (d) => {
  const l = firstLink(d, 'refines');
  l.to.ref = `model:${M}/held__released`;
  l.to.elementHash = elementHash(machines[M], 'held__released')!;
}, /does not mention held__released/);
rejects('derived link whose shared decision the element does not cite', (d) => (firstLink(d, 'allocates-to').sharedRefs = ['D-01']), /does not cite D-01/);
rejects('link type between the wrong layers', (d) => (firstLink(d, 'covers').type = 'designs'), /designs cannot connect/);
rejects('a "missing" link instead of a gap', (d) => ((firstLink(d, 'refines') as { basis: string }).basis = 'missing'), /record an absence as a coverage gap/);
rejects('model endpoint without an element hash', (d) => delete firstLink(d, 'refines').to.elementHash, /needs elementHash/);
rejects('unknown revision', (d) => (firstLink(d, 'refines').from.rev = 'rev-handoff-v3'), /unknown revision "rev-handoff-v3"/);
rejects('a gap with an invented endpoint', (d) => Object.assign(d.gaps[0], { to: 'code:some-service@0000000:holds.ts#L1-L1' }), /a coverage gap has no "to"/);
rejects('a gap kind "no link recorded" stored', (d) => ((d.gaps[0] as { kind: string }).kind = 'not-recorded'), /"no link recorded" is shown, not stored/);
rejects('checked-absent gap without a checked source', (d) => delete d.gaps.find((g) => g.kind === 'checked-absent')!.checked, /must name the source that was checked/);
rejects('checked-absent gap contradicted by a link', (d) => {
  const l = firstLink(d, 'refines');
  d.gaps.push({ id: 'G-99', anchor: l.from.ref, expected: { layer: 'model', relationship: 'refines' }, kind: 'checked-absent', reason: 'test', checked: { source: 'test', rev: 'rev-model-baseline' } });
}, /G-99: says no refines exists, but L-\d+ record one/);
rejects('checked-absent "covers" gap contradicted by an model scenario', (d) =>
  d.gaps.push({ id: 'G-98', anchor: `model:${M}/confirming__booked`, expected: { layer: 'verification', relationship: 'covers' }, kind: 'checked-absent', reason: 'test', checked: { source: 'test', rev: 'rev-model-baseline' } }),
/G-98: says no scenario covers .* but S01/);
rejects('quoted status that no longer appears where it is held', (d) => {
  const rec = d.records.find((r) => r.ref.endsWith('#IX-05') && r.ref.startsWith('handoff:'))!;
  rec.statuses[0].value = rec.statuses[0].quote = 'approved';
}, /status "approved" no longer appears/);
rejects('a check run without revisions', (d) => d.runs.push({ id: 'RUN-01', of: d.tests[0].ref, revisions: [], result: 'pass', ranAt: '2026-11-17', by: 'test' }), /must name the revisions it checked/);
rejects('a check run of something that is not a definition', (d) => d.runs.push({ id: 'RUN-02', of: `model:${M}/held`, revisions: ['rev-model-baseline'], result: 'pass', ranAt: '2026-11-17', by: 'test' }), /is not a recorded test or scenario definition/);
rejects('finding target outside its component', (d) => d.findings[0].targets.push('model:room-search/results'), /is not in component model:booking-hold/);
rejects('finding id outside the XLF- namespace', (d) => (d.findings[0].id = 'FND-01'), /finding id "FND-01"/);
rejects('draft work item that already has an issue key', (d) => (d.workItems[0].key = 'TRK-1'), /a draft work item has no issue key yet/);
rejects('work item tracking an unknown finding', (d) => (d.workItems[0].findings = ['XLF-77']), /no finding XLF-77/);
rejects('duplicate dedupe key', (d) => d.workItems.push({ ...d.workItems[0], id: 'WI-02' }), /same dedupeKey as WI-01/);
rejects('duplicate link', (d) => d.links.push({ ...d.links[0], id: 'L-999' }), /duplicate of an earlier/);

// one finding may have several work items, and one work item several findings
{
  const d = clone();
  d.workItems.push({ ...d.workItems[0], id: 'WI-02', dedupeKey: 'xlf:other', findings: ['XLF-01', 'XLF-02'] });
  const r = validateTrace(d, { checkBaselineDiff: false });
  check('allows several work items per finding and several findings per work item', r.errors.length === 0, r.errors.join('; '));
}

// ---- pinned versions ---------------------------------------------------------------------------
check('handoff v1 reference stays pinned to v1', pinnedPath(`handoff:${SLICE}/v1#IX-05`) === `${HANDOFFS}/${SLICE}/v1/`);
check('design-map v1 reference stays pinned to v1', pinnedPath(`design-map:${SLICE}/v1#IX-05`) === `${HANDOFFS}/${SLICE}/design/v1/DESIGN_MAP.md`);
{
  // IX-06's wording changed from v1 to v2; each reference must keep resolving to its own version's text,
  // now that a later version exists beside the pinned one.
  const v1 = resolveRef(`handoff:${SLICE}/v1#IX-06`, base);
  const v2 = resolveRef(`handoff:${SLICE}/v2#IX-06`, base);
  check('v1 and v2 of the same id resolve to their own texts', v1.ok === true && v2.ok === true && v1.text !== v2.text);
  const pinned = base.links.filter((l) => /^(handoff|design-map):[^/]+\/v1#/.test(l.from.ref) || /^(handoff|design-map):[^/]+\/v1#/.test(l.to.ref));
  check(`every handoff and design-map reference in the example names v1 (${pinned.length} links)`, pinned.length > 0 && base.links.every((l) => ![l.from.ref, l.to.ref].some((r) => /^(handoff|design-map):/.test(r) && !/\/v1#/.test(r))));
}

// ---- hashes --------------------------------------------------------------------------------------
const nodeSha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const vectors = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000), 'Résumé “quotes” — ✓ 室'];
check('sha256 matches node:crypto on test vectors', vectors.every((v) => sha256Hex(v) === nodeSha(v)));
check('sha256("abc") is the published digest', sha256Hex('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

const all: { m: MachineDef; id?: string }[] = machineList.flatMap((m) => [{ m }, ...m.states.map((s) => ({ m, id: s.id })), ...m.transitions.map((t) => ({ m, id: t.id }))]);
const first = all.map(({ m, id }) => elementHash(m, id));
const second = all.map(({ m, id }) => elementHash(m, id));
check(`every element hashes the same twice (${all.length} elements)`, first.every((h, i) => h === second[i] && !!h));
check('the in-browser SHA-256 equals node:crypto for every element', all.every(({ m, id }, i) => first[i] === `sha256:${nodeSha(canonicalJson(elementPayload(m, id)))}`));
check('no two elements share a hash', new Set(first).size === first.length);

const save = machines[M];
const reordered: MachineDef = { ...save, states: save.states.map((s) => Object.fromEntries(Object.entries(s).reverse()) as typeof s) };
check('key order does not change a hash', save.states.every((s) => elementHash(save, s.id) === elementHash(reordered, s.id)));

const edited: MachineDef = structuredClone(save);
edited.states.find((s) => s.id === 'held')!.rules![0] += ' (edited)';
const changed = [...save.states.map((s) => s.id), ...save.transitions.map((t) => t.id)].filter((id) => elementHash(save, id) !== elementHash(edited, id));
check('editing one rule changes only that element\'s hash', changed.length === 1 && changed[0] === 'held', changed.join(', '));
check('editing a state does not change the machine-level hash', elementHash(save) === elementHash(edited));

// ---- recorded hashes are validated against the pinned snapshot, never the current model ------------
// Current differences between the pin and the working model are the staleness report's business.
const recorded = base.links.flatMap((l) => [l.from, l.to]).filter((e) => e.elementHash);
const pinned = await modelAt(REPO_DIR, base.baseline.modelCommit);
check(`the pinned snapshot (src/model at ${base.baseline.modelCommit.slice(0, 7)}) loads`, pinned !== null);
if (pinned) {
  const wrong = recorded.filter((e) => {
    const [, path] = e.ref.split(':');
    const [mid, el] = path.split('/');
    return elementHash(pinned.machines[mid], el) !== e.elementHash;
  });
  check(`recorded element hashes match the pinned snapshot (${recorded.length} endpoints)`, wrong.length === 0, wrong.slice(0, 3).map((e) => e.ref).join(', '));
  const v = validateTrace(base, { checkBaselineDiff: false, pinned });
  check('the example data validates against its pinned snapshot', v.errors.length === 0, v.errors.slice(0, 3).join('; '));
  const d = clone();
  d.links.find((l) => l.to.elementHash)!.to.elementHash = 'sha256:' + '0'.repeat(64);
  check('a recorded hash that is not the pinned element is an error', validateTrace(d, { checkBaselineDiff: false, pinned }).errors.some((e) => /does not match .* in the pinned snapshot/.test(e)));
  const edited = structuredClone(pinned.machines);
  edited[M].states.find((x) => x.id === 'held')!.rules = ['changed after the pin'];
  check('a change in the current model alone is not a validation error (the pin is what is checked)', validateTrace(base, { checkBaselineDiff: false, pinned }).errors.length === 0 && elementHash(edited[M], 'held') !== elementHash(pinned.machines[M], 'held'));
}
const missing = validateTrace(base, { checkBaselineDiff: false, pinned: null });
check('a missing pinned snapshot is an explicit failure, with no substitution of the current model', missing.errors.some((e) => /pinned snapshot .* could not be loaded.*current model is not substituted/.test(e)));
const unsupplied = validateTrace(base, { checkBaselineDiff: false });
check('without a pinned snapshot supplied, hashes are reported as not validated', unsupplied.warnings.some((w) => /recorded element hashes were not validated/.test(w)));

rmSync(fixtureRoot, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
