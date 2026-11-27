// Loads the model exactly as it was at a commit (the trace's pinned snapshot), from git, into a
// temporary folder. Returns null when that commit or its model cannot be loaded; callers must then report the
// limitation and must not fall back to the current model.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ModelSnapshot } from './staleness-core';

export async function modelAt(repoDir: string, commit: string): Promise<ModelSnapshot | null> {
  const tmp = mkdtempSync(join(tmpdir(), 'loom-pinned-'));
  try {
    execFileSync('sh', ['-c', `git -C "${repoDir}" archive ${commit} src/model | tar -x -C "${tmp}"`], { stdio: 'ignore' });
    writeFileSync(join(tmp, 'package.json'), '{"type":"module"}\n');
    const m = await import(pathToFileURL(join(tmp, 'src/model/index.ts')).href);
    return { machines: m.machines, scenarios: m.scenarios, questions: m.openQuestions };
  } catch {
    return null;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
