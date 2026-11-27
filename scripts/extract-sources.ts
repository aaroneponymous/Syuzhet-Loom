// Reads the source documents and writes:
//   src/model/generated/sources.json  (the wording behind every stable id, bundled into the viewer)
//   SOURCE_VERSIONS.md                (which files, with which content hashes, the model represents)
// Only needed when the sources change. The viewer itself never reads the source folder.
//   npm run extract-sources [-- <path to the source folder>]     default: <workspace>/<specDir> (loom.config.ts)
//
// Format read (Markdown tables; the first cell of a row is the id, bold or not):
//   DECISION_REGISTER.md          | D-nn | decision | why |        and  | DF-nn or S-nn | text | note |
//   journeys/Jnn-<name>.md        "# Jnn Title" heading;  | AC-Jnn-nn | criterion | from | note |
//   POLICY_PARAMETERS.md          | PN-nn | parameter | further cells joined as the note |
//   RELEASE_PRIORITIES.md         | RP-nn | priority  | … |
//   ARCHITECTURE_FOLLOW_UPS.md    | AF-nn or EV-nn | follow-up | … |
//   OPEN_QUESTIONS.md and any other *.md directly in the folder are hashed for the record but not parsed:
//   open questions are written in src/model/questions.ts.
// Only DECISION_REGISTER.md is required. A row is taken only from the file its id family belongs to, so a
// table that merely mentions an id elsewhere does not redefine it.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { REPO_DIR, SPEC, WORKSPACE } from './workspace';

const SRC = resolve(process.argv[2] ?? join(WORKSPACE, SPEC));
if (!existsSync(join(SRC, 'DECISION_REGISTER.md'))) {
  console.error(`DECISION_REGISTER.md not found in ${SRC}\nPass the source folder: npm run extract-sources -- <path>, or set LOOM_WORKSPACE.`);
  process.exit(1);
}

const journeyFiles = existsSync(join(SRC, 'journeys'))
  ? readdirSync(join(SRC, 'journeys'))
      .filter((f) => /^J\d\d.*\.md$/.test(f))
      .sort()
      .map((f) => `journeys/${f}`)
  : [];
const topLevel = readdirSync(SRC)
  .filter((f) => f.endsWith('.md') && f !== 'DECISION_REGISTER.md')
  .sort();
const files = ['DECISION_REGISTER.md', ...journeyFiles, ...topLevel];

type Entry = { kind: string; text: string; why?: string; from?: string; note?: string; journey?: string };
const refs: Record<string, Entry> = {};
const clean = (s: string) =>
  s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\\\|/g, '|')
    .trim();
const cells = (line: string) =>
  line
    .replace(/\\\|/g, '\u0000')
    .split('|')
    .slice(1, -1)
    .map((c) => clean(c.replace(/\u0000/g, '|')));

const versions: { file: string; sha256: string; bytes: number }[] = [];
const journeys: { id: string; title: string; file: string }[] = [];
for (const f of files) {
  const raw = readFileSync(join(SRC, f));
  versions.push({ file: f, sha256: createHash('sha256').update(raw).digest('hex'), bytes: raw.length });
  const text = raw.toString('utf8');
  const journey = /^journeys\/(J\d\d)/.exec(f)?.[1];
  if (journey) {
    const title = clean(text.match(new RegExp(`^# ${journey}\\s+(.+)$`, 'm'))?.[1] ?? '');
    journeys.push({ id: journey, title, file: f });
    refs[journey] = { kind: 'Journey', text: title || journey, note: f };
  }
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue;
    const c = cells(line);
    const id = c[0]?.replace(/^\*+|\*+$/g, '');
    if (!id) continue;
    if (/^D-\d+$/.test(id) && f === 'DECISION_REGISTER.md') refs[id] = { kind: 'Decision', text: c[1], why: c[2] };
    else if (/^(DF|S)-\d+$/.test(id) && f === 'DECISION_REGISTER.md')
      refs[id] = { kind: id.startsWith('DF') ? 'Deferred' : 'Superseded', text: c[1], note: c[2] };
    else if (journey && new RegExp(`^AC-${journey}-\\d+$`).test(id)) refs[id] = { kind: 'Acceptance criterion', text: c[1], from: c[2], note: c[3] || undefined, journey };
    else if (/^PN-\d+$/.test(id) && f === 'POLICY_PARAMETERS.md') refs[id] = { kind: 'Policy parameter', text: c[1], note: c.slice(2).filter(Boolean).join(' · ') };
    else if (/^RP-\d+$/.test(id) && f === 'RELEASE_PRIORITIES.md') refs[id] = { kind: 'Release priority', text: c[1], note: c.slice(2).filter(Boolean).join(' · ') };
    else if (/^(AF|EV)-\d+$/.test(id) && f === 'ARCHITECTURE_FOLLOW_UPS.md')
      refs[id] = { kind: id.startsWith('AF') ? 'Architecture follow-up' : 'Evaluation follow-up', text: c[1], note: c.slice(2).filter(Boolean).join(' · ') };
  }
}

const count = (re: RegExp) => Object.keys(refs).filter((k) => re.test(k)).length;
const summary: Record<string, number> = {
  decisions: count(/^D-/),
  ...Object.fromEntries(journeys.map((j) => [`criteria ${j.id}`, count(new RegExp(`^AC-${j.id}-`))])),
  parameters: count(/^PN-/),
  releasePriorities: count(/^RP-/),
  architecture: count(/^AF-/),
  evaluation: count(/^EV-/),
  deferred: count(/^DF-/),
  superseded: count(/^S-/),
};

// The folder is recorded relative to this repository when it is inside it, otherwise by name only:
// no absolute local path is written into generated files.
const rel = relative(REPO_DIR, SRC);
const folder = rel.startsWith('..') ? SRC.split(/[\\/]/).pop()! : rel.split('\\').join('/');

const sourcesJsonPath = join(REPO_DIR, 'src/model/generated/sources.json');
let extractedAt = new Date().toISOString();
if (existsSync(sourcesJsonPath)) {
  try {
    const prev = JSON.parse(readFileSync(sourcesJsonPath, 'utf8'));
    const prevFiles = prev?.record?.archive?.files;
    const sameFiles =
      Array.isArray(prevFiles) &&
      prevFiles.length === versions.length &&
      versions.every((v, i) => v.file === prevFiles[i]?.file && v.sha256 === prevFiles[i]?.sha256 && v.bytes === prevFiles[i]?.bytes);
    if (sameFiles && prev?.record?.extractedAt) {
      extractedAt = prev.record.extractedAt;
    }
  } catch {
    // Keep new timestamp on parse failure
  }
}

const record = {
  extractedAt,
  journeys,
  archive: { folder: `${folder}/`, files: versions },
  summary,
};

writeFileSync(join(REPO_DIR, 'src/model/generated/sources.json'), JSON.stringify({ refs, record }, null, 1) + '\n');

const md = `# Source versions

The model represents these source documents. Regenerate with \`npm run extract-sources\`.

Extracted: ${record.extractedAt}

Folder: \`${record.archive.folder}\`

## Journeys

${journeys.length ? `| Journey | Title | File |\n|---|---|---|\n${journeys.map((j) => `| ${j.id} | ${j.title} | \`${j.file}\` |`).join('\n')}` : 'None.'}

## Source files

| File | SHA-256 | Bytes |
|---|---|---|
${versions.map((v) => `| \`${v.file}\` | \`${v.sha256}\` | ${v.bytes} |`).join('\n')}

## Ids extracted

| Kind | Count |
|---|---|
${Object.entries(summary).map(([k, v]) => `| ${k} | ${v} |`).join('\n')}
`;
writeFileSync(join(REPO_DIR, 'SOURCE_VERSIONS.md'), md);
console.log(summary);
