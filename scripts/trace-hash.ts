// Prints the deterministic hash of model elements: npx tsx scripts/trace-hash.ts model:booking-hold/held ...
// With no arguments, prints every element of every machine. Writes nothing.
import { machineList, machines } from '../src/model';
import { elementHash } from '../src/trace/hash';
import { parseRef } from '../src/trace/refs';

const args = process.argv.slice(2);
if (!args.length) {
  for (const m of machineList) {
    console.log(`model:${m.id}\t${elementHash(m)}`);
    for (const s of m.states) console.log(`model:${m.id}/${s.id}\t${elementHash(m, s.id)}`);
    for (const t of m.transitions) console.log(`model:${m.id}/${t.id}\t${elementHash(m, t.id)}`);
  }
} else {
  let bad = 0;
  for (const a of args) {
    const p = parseRef(a);
    const m = p?.scheme === 'model' ? machines[p.machine] : undefined;
    const h = m && p?.scheme === 'model' ? elementHash(m, p.element) : null;
    if (!h) bad++;
    console.log(`${a}\t${h ?? 'NOT FOUND'}`);
  }
  process.exit(bad ? 1 : 0);
}
