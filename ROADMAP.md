# Roadmap

What exists today is in the [README](README.md). This file is what does not exist yet. Nothing here is promised by a date.

## Now: make v0.1 usable by someone else

- **Separate the engine from the model.** Today the model lives in `src/model/` of this repository and you adopt Syuzhet Loom by replacing the example. Next: an installable package and a CLI (`syuzhet-loom validate`, `syuzhet-loom trace validate`, `syuzhet-loom staleness`, `syuzhet-loom view`) that point at a model in your own repository.
- **A documented, versioned model schema** (and a JSON form of the model, so tools in other languages can read it).
- **Scaffolding**: `syuzhet-loom init` to create a model, a workspace and an empty trace.
- **Viewer**: a findings drawer, a "has trace gap" highlight by layer, keyboard navigation.
- **A conventional test runner** for the self-tests, with coverage.

## Next: the workflow around the model

- **Agent role and workflow definitions, and a dry-run context assembler.** A scaffold exists privately: it resolves a task to the exact model elements, pinned sources, settled and unresolved inputs an agent would start from, and launches nothing. It is tied to one workspace and is not in this release.
- **Issue-tracker integration** (Linear first): create or link an issue from a work item, with de-duplication keys. A workspace-setup tool exists privately; the agent-facing integration does not.
- **Design integration** (Figma): the trace already has a `figma:` reference scheme pinned through a design map; reading Figma itself is not implemented.
- **Evidence ingestion**: record check runs from CI output (JUnit XML and similar) against named revisions, so that the trace can show results and not only definitions.
- **Agent skills** for behaviour definition and design hand-off, published as reusable templates.

## Later: verification

Syuzhet Loom today performs structural validation, coverage accounting, trace validation against pinned revisions, and staleness detection. None of these shows that a model is *right*.

- **Simulation**: step a machine through a scenario and check that the path exists (today a scenario is a list of steps checked for existence, not executed).
- **Model-based and property-based test generation** from machines and scenarios.
- **Export to a model checker** (TLA+/TLC is the candidate) for reachability, deadlock and invariant checks.

No formal model, model-checking run or proof exists today.

## Not planned

- A hosted service, accounts or live collaboration.
- Automatic resolution of open questions or automatic refresh of pinned references.
