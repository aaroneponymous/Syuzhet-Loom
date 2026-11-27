// Prints every modelling interpretation marked in the model, as Markdown.
import { machineList } from '../src/model/index';
let n = 0;
const out: string[] = [];
for (const m of machineList) {
  const rows: string[] = [];
  for (const t of m.interpretations ?? []) rows.push(`- *(whole component)* ${t}`);
  for (const s of m.states) if (s.interpretation) rows.push(`- **${s.label}** (state \`${s.id}\`): ${s.interpretation}`);
  for (const t of m.transitions) if (t.interpretation) rows.push(`- **${t.event}** (\`${t.id}\`): ${t.interpretation}`);
  if (rows.length) {
    n += rows.length;
    out.push(`### ${m.title} (\`${m.id}\`)\n\n${rows.join('\n')}\n`);
  }
}
console.log(`${n} interpretations are marked.\n\n${out.join('\n')}`);
