// Structural validation of the model. Does not establish semantic correctness.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT_MACHINE, machineList, openQuestions, scenarios } from '../src/model/index';
import { REPO_DIR } from './workspace';
import type { MachineDef } from '../src/model/types';

const errors: string[] = [];
const warnings: string[] = [];
const err = (m: string) => errors.push(m);

const byId = new Map<string, MachineDef>();
for (const m of machineList) {
  if (byId.has(m.id)) err(`duplicate machine id: ${m.id}`);
  byId.set(m.id, m);
}
const questionIds = new Set(openQuestions.map((q) => q.id));
if (questionIds.size !== openQuestions.length) err('duplicate open-question id');

// The id families (see MODELING.md). MODEL-<WORD> is the model's own label for something no source id names.
const REF = /^(D|P|DF|S|Q|PN|RP|AF|EV)-\d+$|^C-\d+$|^AC-J\d\d-\d+$|^MODEL-[A-Z]+$/;
// Ids that exist: the extracted source wording plus the model's open questions. Without an extraction, only the form is checked.
const sourcesFile = join(REPO_DIR, 'src/model/generated/sources.json');
const knownIds: Set<string> | null = existsSync(sourcesFile) ? new Set([...Object.keys(JSON.parse(readFileSync(sourcesFile, 'utf8')).refs ?? {}), ...openQuestions.map((q) => q.id)]) : null;
if (!knownIds) warnings.push('src/model/generated/sources.json not found: references were checked for form only (run `npm run extract-sources`)');
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Resolves an entry or exit spec ('state' or 'state:name') to check it ends at a real state. */
function resolvePoint(m: MachineDef, spec: string, which: 'entries' | 'exits', depth = 0): string | null {
  if (depth > 8) return 'mapping recursion too deep';
  const [stateId, name] = spec.split(':');
  const st = m.states.find((x) => x.id === stateId);
  if (!st) return `maps to unknown state "${stateId}"`;
  if (!name) return null;
  if (!st.uses) return `"${spec}" delegates into "${stateId}", which is not a composite`;
  const sub = byId.get(st.uses);
  if (!sub) return `"${stateId}" uses unknown machine "${st.uses}"`;
  const next = sub[which]?.[name];
  if (!next) return `machine "${sub.id}" has no ${which === 'entries' ? 'entry' : 'exit'} named "${name}"`;
  return resolvePoint(sub, next, which, depth + 1);
}

function checkRefs(where: string, refs?: string[]) {
  for (const r of refs ?? []) {
    if (!REF.test(r)) err(`${where}: malformed reference "${r}"`);
    else if (knownIds && !/^MODEL-/.test(r) && !knownIds.has(r)) warnings.push(`${where}: cites "${r}", which is not in the extracted sources or the open questions`);
  }
}
function checkOpen(where: string, open?: { questions: string[]; note: string }) {
  if (!open) return;
  if (!open.note) err(`${where}: open mark without a note`);
  if (!open.questions.length) err(`${where}: open mark without a question id`);
  for (const q of open.questions) if (!questionIds.has(q)) err(`${where}: open mark cites unknown question "${q}"`);
}

for (const m of machineList) {
  const W = `machine ${m.id}`;
  if (!KEBAB.test(m.id)) err(`${W}: id is not kebab-case`);
  checkRefs(W, m.refs);
  const stateIds = new Set<string>();
  for (const st of m.states) {
    const SW = `${m.id}/${st.id}`;
    if (!KEBAB.test(st.id)) err(`${SW}: id is not kebab-case`);
    if (stateIds.has(st.id)) err(`${SW}: duplicate state id`);
    stateIds.add(st.id);
    if (!st.label) err(`${SW}: missing label`);
    if (st.label.length > 34) warnings.push(`${SW}: label longer than 34 characters ("${st.label}")`);
    checkRefs(SW, st.refs);
    checkOpen(SW, st.open);
    if (st.uses) {
      const sub = byId.get(st.uses);
      if (!sub) err(`${SW}: uses unknown machine "${st.uses}"`);
      else if (sub.id === m.id) err(`${SW}: machine uses itself`);
    }
    if (m.parallel && (st.kind === 'initial' || st.kind === 'final' || st.kind === 'choice'))
      err(`${SW}: a parallel machine has regions, not ${st.kind} states`);
  }
  if (m.kind !== 'boundary' && m.states.length === 0) err(`${W}: no states`);
  if (m.kind === 'boundary' && (m.states.length || m.transitions.length)) err(`${W}: a boundary must have no internals`);

  const tIds = new Set<string>();
  for (const tr of m.transitions) {
    const TW = `${m.id}/${tr.id}`;
    if (tIds.has(tr.id)) err(`${TW}: duplicate transition id`);
    if (stateIds.has(tr.id)) err(`${TW}: transition id collides with a state id`);
    tIds.add(tr.id);
    if (!tr.event) err(`${TW}: missing event label`);
    if (m.kind !== 'overview') {
      if (tr.flow !== 'main' && tr.flow !== 'side') err(`${TW}: missing flow ('main' or 'side')`);
      if (tr.kind !== 'signal' && !['user', 'app', 'time', 'unstated'].includes(tr.actor ?? '')) err(`${TW}: missing actor ('user', 'app', 'time' or 'unstated')`);
    }
    if (tr.actor && !['user', 'app', 'time', 'unstated'].includes(tr.actor)) err(`${TW}: unknown actor "${tr.actor}"`);
    if (tr.event.length > 30) warnings.push(`${TW}: event label longer than 30 characters ("${tr.event}")`);
    checkRefs(TW, tr.refs);
    checkOpen(TW, tr.open);
    const from = m.states.find((x) => x.id === tr.from);
    const to = m.states.find((x) => x.id === tr.to);
    if (!from) err(`${TW}: unknown source state "${tr.from}"`);
    if (!to) err(`${TW}: unknown target state "${tr.to}"`);
    if (m.parallel && tr.kind !== 'signal') err(`${TW}: transitions between regions of a parallel machine must be signals`);
    if (from?.kind === 'final' && tr.kind !== 'signal' && !m.exits) warnings.push(`${TW}: leaves a final state`);
    if (to?.kind === 'initial') err(`${TW}: targets an initial state`);
    if (tr.fromExit) {
      if (!from?.uses) err(`${TW}: fromExit on a source that is not a composite`);
      else {
        const sub = byId.get(from.uses);
        const spec = sub?.exits?.[tr.fromExit];
        if (!sub) {
          /* reported above */
        } else if (!spec) err(`${TW}: machine "${sub.id}" has no exit named "${tr.fromExit}"`);
      }
    }
    if (to?.uses) {
      const sub = byId.get(to.uses);
      const name = tr.toEntry ?? 'default';
      if (sub && sub.kind !== 'boundary' && !sub.parallel && !sub.entries?.[name])
        err(`${TW}: machine "${sub.id}" has no entry named "${name}"`);
      if (sub && tr.toEntry && sub.parallel && !sub.entries?.[tr.toEntry])
        err(`${TW}: machine "${sub.id}" has no entry named "${tr.toEntry}"`);
    } else if (tr.toEntry) err(`${TW}: toEntry on a target that is not a composite`);
  }

  for (const which of ['entries', 'exits'] as const) {
    for (const [name, spec] of Object.entries(m[which] ?? {})) {
      const problem = resolvePoint(m, spec, which);
      if (problem) err(`${W}: ${which}.${name} ${problem}`);
    }
  }

  if (!m.parallel && m.kind !== 'boundary') {
    const initials = m.states.filter((x) => x.kind === 'initial');
    if (initials.length > 1) err(`${W}: more than one initial state`);
    // reachability from initial states and entry points
    const starts = new Set<string>(initials.map((x) => x.id));
    for (const spec of Object.values(m.entries ?? {})) starts.add(spec.split(':')[0]);
    if (starts.size === 0) warnings.push(`${W}: no initial state and no entries`);
    const reach = new Set(starts);
    let grew = true;
    while (grew) {
      grew = false;
      for (const tr of m.transitions)
        if (reach.has(tr.from) && !reach.has(tr.to)) {
          reach.add(tr.to);
          grew = true;
        }
    }
    for (const st of m.states) if (!reach.has(st.id)) warnings.push(`${m.id}/${st.id}: not reachable from an initial state or entry`);
    // the main path should lead from the start to a successful end, where the machine has ends
    // A successful condition is an end state or a named exit. Record lifecycles are exempt: their ordinary
    // condition is a lasting state ("saved"), and their end states are removal or expiry.
    const finals = [...m.states.filter((x) => x.kind === 'final').map((x) => x.id), ...Object.values(m.exits ?? {}).map((v) => v.split(':')[0])];
    if (finals.length && starts.size && m.kind !== 'entity') {
      const main = new Set(starts);
      let more = true;
      while (more) {
        more = false;
        for (const tr of m.transitions)
          if (tr.flow === 'main' && main.has(tr.from) && !main.has(tr.to)) {
            main.add(tr.to);
            more = true;
          }
      }
      if (!finals.some((f) => main.has(f))) warnings.push(`${W}: no main path from the start to an end state or exit`);
    }
  }
}

// every machine except the root should be used somewhere
const used = new Set<string>([ROOT_MACHINE]);
for (const m of machineList) for (const st of m.states) if (st.uses) used.add(st.uses);
for (const m of machineList) if (!used.has(m.id)) warnings.push(`machine ${m.id}: defined but never used`);

// composition cycles
function cyc(id: string, stack: string[]): void {
  if (stack.includes(id)) {
    err(`composition cycle: ${[...stack, id].join(' > ')}`);
    return;
  }
  const m = byId.get(id);
  if (!m) return;
  for (const st of m.states) if (st.uses) cyc(st.uses, [...stack, id]);
}
if (!byId.has(ROOT_MACHINE)) err(`no root machine "${ROOT_MACHINE}"`);
cyc(ROOT_MACHINE, []);

// scenarios: every step must point at a real state or event, and consecutive steps should connect
const scIds = new Set<string>();
for (const sc of scenarios) {
  if (scIds.has(sc.id)) err(`scenario ${sc.id}: duplicate id`);
  scIds.add(sc.id);
  if (!sc.steps.length) err(`scenario ${sc.id}: no steps`);
  for (const q of sc.questions ?? []) if (!questionIds.has(q)) err(`scenario ${sc.id}: cites unknown question "${q}"`);
  if (sc.outcome === 'gap' && !(sc.questions ?? []).length) err(`scenario ${sc.id}: ends at a gap but names no question`);
  sc.steps.forEach((st, i) => {
    const m = byId.get(st.machine);
    if (!m) return err(`scenario ${sc.id} step ${i + 1}: unknown machine "${st.machine}"`);
    if (!m.states.some((x) => x.id === st.element) && !m.transitions.some((x) => x.id === st.element))
      err(`scenario ${sc.id} step ${i + 1}: "${st.element}" is not a state or event of ${st.machine}`);
    if (!st.note) err(`scenario ${sc.id} step ${i + 1}: missing note`);
  });
}

const nStates = machineList.reduce((n, m) => n + m.states.length, 0);
const nTrans = machineList.reduce((n, m) => n + m.transitions.length, 0);
console.log(`machines: ${machineList.length}  states: ${nStates}  transitions: ${nTrans}  open questions: ${openQuestions.length}  scenarios: ${scenarios.length}`);
for (const w of warnings) console.log(`warning: ${w}`);
for (const e of errors) console.error(`ERROR: ${e}`);
console.log(errors.length ? `FAILED with ${errors.length} error(s)` : `OK (${warnings.length} warning(s))`);
process.exit(errors.length ? 1 : 0);
