# Architecture

What the parts are, how they relate, and what each check does and does not establish.

```
 source documents ──extract-sources──▶ sources.json ─┐
 (workspace/spec)                     SOURCE_VERSIONS.md
                                                      │
 src/model  (types, dsl, machines, questions, ────────┼──▶ validate ──▶ well-formed?
             scenarios, meta)                         ├──▶ coverage ──▶ COVERAGE.md
                    │                                 └──▶ viewer (React Flow) ◀── response log (local)
                    │ element hashes                              ▲
                    ▼                                             │ bundled at build
 trace/*.json  (refs, revisions, links, gaps,  ──validate:trace──▶ resolves at the pinned commit?
                statuses, definitions, runs,   ──trace-staleness─▶ trace-reports/ (generated)
                findings, work items)
                    │ points into
                    ▼
 workspace/handoffs/<slice>/vN, design/vN ; other git repositories (code:, test:)
```

## The model

`src/model/` is plain typed data.

- `types.ts` is the schema: a `MachineDef` has states and transitions; a state may be a composite that `uses` another machine; machines used as composites name `entries` and `exits`; a `parallel` machine's states are regions that interact through signals; an `open` mark ties an element to an open question; `interpretation` marks what the modeller added.
- `dsl.ts` is a few helpers (`machine`, `s`, `t`, `signal`, `initial`, `final`). `machine()` gives every transition a stable id.
- `index.ts` exports `machineList`, `machines`, `ROOT_MACHINE`, the open questions, the scenarios and `modelMeta`. Everything else imports the model through it, including the loader that reads the model at an old commit, so `src/model` must stay self-contained (no imports from outside the folder).
- `meta.ts` holds what the viewer says about the model (title, description, source note, changed ids).
- `generated/sources.json` is written by `npm run extract-sources` from the source documents: the wording behind each id, and a record of which files with which hashes were read. `SOURCE_VERSIONS.md` is the same record for people.

The bundled model, source documents, handoffs and trace are an invented example. See `MODELING.md` for how a model is written.

## Checks on the model

| Command | Establishes | Does not establish |
|---|---|---|
| `npm run validate` (`scripts/validate.ts`) | Ids are unique and well formed; every transition joins real states; `uses`, entries and exits resolve; parallel machines use signals; every element outside the overview has an actor and a flow; open marks name real questions; scenario steps point at real elements; no composition cycle. Warnings: unreachable states, no main path to an end, unused machines, long labels, an id that is not in the extracted sources | That the model says what the source documents say. That is a human review |
| `npm run coverage` (`scripts/coverage.ts`) | Where each acceptance criterion is cited: by an element, as a non-visual rule, or nowhere (a gap); which decisions are cited by nothing; where each open question is marked | That a citation is a correct representation |
| `npx tsx scripts/list-interpretations.ts` | Lists every interpretation the model marks | — |

## The viewer

`src/viewer/` renders the model with React Flow and lays it out with dagre. It is a static build (`dist/`), with relative asset paths, bundled fonts and no network requests.

- `graph.ts` turns machines into nodes and edges, expanding composites in place and re-attaching a transition to the mapped entry or exit state when its composite is open.
- `App.tsx` does hash routing (`#/<machine>/<selection>?via=…&q=…`), search, the path emphasis and the highlight lenses. `Panel.tsx` shows an element's rules, guard, effects and source wording; `Drawers.tsx` the open points and Help; `Scenarios.tsx` plays a scenario step by step.
- `Trace.tsx` and `Staleness.tsx` show, read-only, what the trace and the staleness report hold for the selected element.
- The text that describes the model comes from `src/model/meta.ts`. Browser storage keys start with `syuzhet-loom-`.

### The response log

`responses-plugin.ts` is a Vite plugin for `npm run dev` and `npm run preview`. It serves `/__responses`, so that an answer or comment typed in the viewer is written to `responses/responses.json` and a readable `responses/RESPONSES.md` on this machine. A response is input for review; it is not a decision and changes nothing in the model. Opened as plain files, without the server, the viewer keeps responses in the browser's local storage instead. `responses/` is not committed.

## The trace

A sidecar that records how model elements relate to other layers. `docs/TRACE.md` describes its concepts; in short:

- **References** (`src/trace/refs.ts`) are strings with a scheme: a spec id, `model:`, `handoff:`, `design-map:`, `figma:`, `code:`, `test:`, `notion:`, `model-scenario:`, `finding:`, `work:`. Versioned forms carry their version.
- **Revisions** say which version of a source something was recorded against, with a file hash where there is one. The trace names one **baseline commit** of this repository.
- **Element hashes** (`src/trace/hash.ts`) are SHA-256 over the canonical JSON of one element's own definition. The implementation is self-contained so that the browser and Node compute the same value.
- **Links** join two endpoints that both exist, with a type and a basis (`stated`, `derived`, `interpretation`).
- **Coverage gaps** record an expected relationship that is absent (`checked-absent`, naming what was checked) or deliberately not traced (`out-of-scope`), without inventing an endpoint.
- **Status records** quote a status from the record that holds it. Nothing computes one.
- **Definitions and runs** are separate: a scenario or test definition says a check exists; only a recorded check run carries a result.
- **Findings** (`XLF-nn`) attach an observation to elements of a component; **work items** (`WI-nn`) are drafts of issues for them. Nothing is sent to a tracker.

`src/trace/index.ts` holds the read-only queries the viewer uses (`traceFor`). The viewer bundles the trace named in `loom.config.ts`; with no trace file it still renders, and every element reads "Not traced yet".

### Checks on the trace

| Command | Establishes | Does not establish |
|---|---|---|
| `npm run validate:trace` (`scripts/validate-trace.ts`) | The baseline commit exists and `src/model` loads from it (`scripts/pinned-model.ts`); every model reference resolves in that pinned model and every recorded element hash equals the element there; every handoff and design reference resolves in the version it names; code and test references resolve at their commit when the repository is on this machine; each locally held status quote still appears where it is held; link types join the right layers and agree with their basis; no gap contradicts a link or a model scenario; a run names a definition and its revisions; ids and dedupe keys are unique | That a link is true (an `interpretation` is someone's reading). That the model still matches the baseline: a difference is a warning here and is reported by the staleness report. Anything about services that are not read |
| `npm run test:trace` (`scripts/trace-selftest.ts`) | The validator rejects each kind of invalid record (one mutation of the example trace per case); references stay pinned to their version; the hash implementation equals `node:crypto` and is stable, order-independent and local to one element; the pinned-snapshot rules hold. Code and test references are exercised against a small git repository the test creates in the temporary folder | — |
| `npm run trace-staleness` (`scripts/trace-staleness.ts`, `scripts/staleness-core.ts`) | For each reference: whether the pin still matches what was recorded, and whether a later version changed, removed or kept the item; for model elements, whether listed dependencies changed; which links, findings, work items, gaps and records rest on something that changed ("needs review") | That anything flagged is wrong, or that anything not flagged is right. It reads local files and commits only |
| `npm run test:staleness` (`scripts/trace-staleness-selftest.ts`) | The report's behaviour on in-memory fixtures: unchanged, changed in place, later versions, removed items, unavailable sources, changed dependencies, incomplete drafts, a source changing during the scan | — |
| `npm run trace:repin -- <commit>` (`scripts/trace-repin.ts`) | Every recorded element hash equals the element at `<commit>`; then the trace names that commit. See `docs/RELEASING.md` | It is not a refresh: it refuses when any hash differs |

`staleness-core.ts` is pure: it reads every source through a `World` object, so the self-test can hand it fixtures. `trace-staleness.ts` builds the real `World` from the workspace, git and the model, takes a snapshot so that each file is read once, re-checks the snapshot afterwards, and writes the report.

## Configuration

`loom.config.ts` is the one place that says where things are:

| Setting | Default | Meaning |
|---|---|---|
| `workspace` | `workspace` | The folder that holds handoffs and source documents. `LOOM_WORKSPACE` overrides it |
| `handoffsDir` | `handoffs` | Folder in the workspace with `<slice>/vN/` and `<slice>/design/vN/` |
| `specDir` | `spec` | Folder in the workspace that `extract-sources` reads |
| `repoSearchDirs` | `.`, `..` | Folders (relative to the workspace) searched for the repositories named in `code:` and `test:` references. `LOOM_REPO_DIRS` adds more |
| `traceFile` | `trace/example.json` | The trace the viewer bundles and the scripts read. It must be in `trace/` |
| `reportDir` | `trace-reports` | Where the staleness report is written |

`scripts/workspace.ts` resolves these to absolute paths for the scripts. The config itself has no Node imports, because the viewer reads it too. Paths stored in the trace and in reports are relative to the workspace, never absolute.

## What is committed and what is generated

| | |
|---|---|
| Committed, written by hand | `src/`, `scripts/`, `trace/example.json`, `workspace/`, the docs |
| Committed, generated | `src/model/generated/sources.json`, `SOURCE_VERSIONS.md` (`extract-sources`); `COVERAGE.md` (`coverage`). They are committed because the viewer bundles the first and the staleness report reads the first two at the baseline commit |
| Not committed | `dist/`, `trace-reports/`, `responses/`, `node_modules/` |

## Optional browser check

`scripts/browser-check.mjs` drives the built viewer in a local Chrome through `playwright-core`, which is deliberately not a dependency. It loads the example, expands a machine, opens a state, reads its Trace section, and fails on any console error or any request that leaves the preview server. It is not part of `npm test`.
