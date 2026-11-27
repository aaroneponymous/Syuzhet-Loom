// Points a trace at a different commit of this repository WITHOUT changing anything else in it.
//   npm run trace:repin -- <commit> [path/to/trace.json]
//
// When to use it: the commit a trace pins no longer exists under that id, although the model it pinned is
// byte-for-byte the same. That happens when history is rewritten (a squash, a rebase, or a repository whose
// history is recreated at publication). It is not a way to "refresh" a trace after the model changed: for
// that, review the trace item by item and record a new revision.
//
// What it does: loads src/model as it is at <commit> and checks every element hash recorded in the trace
// against it. Only if every recorded hash equals the element at <commit> does it rewrite the two places
// that name the commit: baseline.modelCommit and the version of revision "rev-model-baseline". Element
// hashes, links, gaps and everything else are left exactly as they were. If any hash differs, nothing is
// written and the differences are listed.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { elementHash } from '../src/trace/hash';
import { parseRef } from '../src/trace/refs';
import type { TraceData } from '../src/trace/types';
import { modelAt } from './pinned-model';
import { REPO_DIR, TRACE_FILE } from './workspace';

const [commitArg, fileArg] = process.argv.slice(2);
if (!commitArg) {
  console.error('usage: npm run trace:repin -- <commit> [path/to/trace.json]');
  process.exit(2);
}
let commit: string;
try {
  commit = execFileSync('git', ['-C', REPO_DIR, 'rev-parse', '--verify', `${commitArg}^{commit}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch {
  console.error(`"${commitArg}" is not a commit in this repository`);
  process.exit(1);
}
const file = resolve(fileArg ?? join(REPO_DIR, TRACE_FILE));
const raw = readFileSync(file, 'utf8');
const data = JSON.parse(raw) as TraceData;
const old = data.baseline?.modelCommit ?? '';

const pinned = await modelAt(REPO_DIR, commit);
if (!pinned) {
  console.error(`src/model could not be loaded at ${commit.slice(0, 7)}: nothing was changed`);
  process.exit(1);
}
const endpoints = data.links.flatMap((l) => [l.from, l.to]).filter((e) => e.elementHash);
const differing = endpoints.filter((e) => {
  const p = parseRef(e.ref);
  const m = p?.scheme === 'model' ? pinned.machines[p.machine] : undefined;
  return !m || !p || p.scheme !== 'model' || elementHash(m, p.element) !== e.elementHash;
});
if (differing.length) {
  console.error(`${differing.length} of ${endpoints.length} recorded element hashes do not equal the model at ${commit.slice(0, 7)}: nothing was changed.`);
  for (const e of differing.slice(0, 20)) console.error(`  ${e.ref}`);
  console.error('This commit does not hold the model the trace was recorded against. Re-pinning is only for a commit whose src/model is identical.');
  process.exit(1);
}
if (old === commit) {
  console.log(`already pinned to ${commit.slice(0, 7)}; ${endpoints.length} recorded element hashes match it`);
  process.exit(0);
}
// Replace the commit id textually, so that the file's formatting and every other byte stay as they were.
const occurrences = old ? raw.split(old).length - 1 : 0;
const rev = data.revisions.find((r) => r.id === 'rev-model-baseline');
if (!/^[0-9a-f]{40}$/.test(old) || rev?.version !== old || occurrences !== 2) {
  console.error(`expected the old commit id in exactly two places (baseline.modelCommit and rev-model-baseline.version); found ${occurrences}. Edit those two by hand.`);
  process.exit(1);
}
writeFileSync(file, raw.split(old).join(commit));
console.log(`re-pinned ${old.slice(0, 7)} → ${commit.slice(0, 7)}: ${endpoints.length} recorded element hashes verified against src/model at the new commit; no hash was changed`);
console.log('now run: npm run validate:trace');
