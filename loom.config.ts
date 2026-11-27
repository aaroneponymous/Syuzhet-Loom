// The one place that says where things live. Plain data with no Node imports, so the viewer can read it too.
// scripts/workspace.ts turns these into absolute paths and applies the LOOM_WORKSPACE override.
export const loomConfig = {
  /**
   * The workspace: the folder that holds the layers the trace points into (handoffs, source documents).
   * Relative to this repository. Override with the environment variable LOOM_WORKSPACE (absolute, or
   * relative to the current directory). The default is the bundled example workspace.
   */
  workspace: 'workspace',
  /** Folder inside the workspace that holds versioned handoffs: <handoffs>/<slice>/vN/ and <handoffs>/<slice>/design/vN/. */
  handoffsDir: 'handoffs',
  /** Folder inside the workspace that holds the source documents `npm run extract-sources` reads. */
  specDir: 'spec',
  /**
   * Folders searched for the other git repositories named in `code:<repo>@<sha>:…` and `test:<repo>@…`
   * references; `<dir>/<repo>/.git` must exist. Relative to the workspace. When a name exists in several,
   * the repository that holds the commit wins. Extra folders can be added with LOOM_REPO_DIRS
   * (separated by the platform path delimiter).
   */
  repoSearchDirs: ['.', '..'],
  /** The trace the viewer bundles and the scripts read by default, relative to this repository. */
  traceFile: 'trace/example.json',
  /** Where `npm run trace-staleness` writes its report, relative to this repository. */
  reportDir: 'trace-reports',
} as const;
