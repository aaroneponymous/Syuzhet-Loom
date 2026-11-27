# Releasing

## The example trace pins a commit of this repository

`trace/example.json` names a commit in `baseline.modelCommit` (and again as the version of revision `rev-model-baseline`). `npm run validate:trace` loads `src/model` **from that commit** and checks every recorded element hash against it. So the commit has to exist in the repository that is published, and in every clone that runs the tests (CI checks out with `fetch-depth: 0` for this reason).

The publication history is three commits, in this order:

1. **Source and model**: the engine, the example model, the workspace and the documents. Everything except `trace/example.json` and the demonstration media.
2. **Trace**: `trace/example.json`, pinned to commit 1.
3. **Demonstration media**: the clips and stills in `docs/media/`, recorded from the build at commit 2 (see `docs/media/README.md`). This commit touches only `docs/media/`, so no pin is affected: `src/model` at commit 1 is what the trace names, and nothing the trace hashes changes.

The release tag goes on commit 3. Until commit 3 exists, the media links in `README.md` point at files that are not there yet.

## When history is recreated

If the repository is published with a new history (a fresh initial commit, a squash, a rebase), the first commit gets a new id and the old one no longer exists. The model in it is unchanged, so the recorded element hashes are still right; only the commit id is wrong. To fix it:

1. Recreate the history so that `src/model` is committed **before** the trace is re-pinned (the trace cannot name the commit that contains its own final text).
2. Re-point the trace at the commit that holds the model:

   ```
   npm run trace:repin -- <commit>
   ```

   The script loads `src/model` at `<commit>`, checks every element hash recorded in the trace against it, and only if all of them match rewrites the two places that name the commit. It changes no hash and nothing else in the file. If a hash does not match, it writes nothing and lists the references: that commit does not hold the model the trace was recorded against.
3. `npm run validate:trace` and `npm test`. The output must say `validated against the pinned snapshot: src/model at <commit>`.
4. Commit `trace/example.json`.
5. Record the demonstration media from a build of that commit (`npm run trace-staleness`, `npm run build && npm run preview`, `node scripts/record-demo.mjs <url> docs/media`) and commit `docs/media/` on its own. The clips then show the baseline id of the commit from step 2.

This procedure is for the bundled example, whose model does not change between the two histories. It is not a way to bring a trace up to date after the model has changed. For that, read `docs/TRACE.md`, "Staleness": run `npm run trace-staleness`, review what it flags item by item, and record a new trace revision.

## Before publishing

- `npm ci && npm test && npm run build` in a fresh clone.
- The fonts in `src/viewer/assets/fonts/` are under the SIL Open Font License; their licence files sit beside them and must stay there.
