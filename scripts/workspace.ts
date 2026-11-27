// Resolves loom.config.ts to absolute paths for the scripts. The viewer never imports this file.
import { existsSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loomConfig } from '../loom.config';

/** This repository: where src/model, the trace and the generated files live. */
export const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** The workspace root. Every "workspace-relative" path in the trace tools is relative to this. */
export const WORKSPACE = process.env.LOOM_WORKSPACE ? resolve(process.env.LOOM_WORKSPACE) : resolve(REPO_DIR, loomConfig.workspace);
export const HANDOFFS = loomConfig.handoffsDir;
export const SPEC = loomConfig.specDir;
export const TRACE_FILE = loomConfig.traceFile;
export const REPORT_DIR = loomConfig.reportDir;

/** Folders that may hold other repositories. Read on every call, so a test can add one through LOOM_REPO_DIRS. */
export function repoSearchDirs(): string[] {
  const extra = (process.env.LOOM_REPO_DIRS ?? '').split(delimiter).filter(Boolean).map((d) => resolve(d));
  return [...extra, ...loomConfig.repoSearchDirs.map((d) => resolve(WORKSPACE, d))];
}

/** The checkouts named `repo` in the search folders, in search order. */
export function repoCandidates(repo: string): string[] {
  return repoSearchDirs()
    .map((d) => join(d, repo))
    .filter((d) => existsSync(join(d, '.git')));
}
