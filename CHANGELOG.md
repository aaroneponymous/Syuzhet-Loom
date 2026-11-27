# Changelog

## 0.1.0

First public release.

### What is in it

- **Model**: a typed schema and a small DSL for hierarchical state machines: journeys, shared components used as composites with named entries and exits, parallel machines with signals, record lifecycles, boundaries for unwritten journeys. Every element cites source ids; undecided behaviour carries an OPEN mark tied to a question; modeller's additions are marked as interpretations.
- **Checks on the model**: structural validation (`npm run validate`), coverage of acceptance criteria (`npm run coverage`), extraction of source wording with file hashes (`npm run extract-sources`).
- **Viewer**: expand in place, focus, search, sources in their original wording, open points, scenarios played step by step, highlight lenses, light and dark themes, deep links. Static build, no network requests.
- **Response log**: answers and comments typed in the viewer are written to a local file for review.
- **Trace**: revision-pinned references across layers, element hashes, typed links with a basis, coverage gaps, quoted statuses, definitions apart from runs, findings and draft work items; validation against the model at the pinned commit (`npm run validate:trace`).
- **Staleness report**: what changed since each reference was pinned, and what rests on it (`npm run trace-staleness`).
- **Example**: meeting-room booking: 9 machines, 45 states, 58 transitions and signals, 3 open questions, 4 scenarios; source documents, two handoff versions, a design map and a trace.
- **Tests**: 53 trace self-test checks and 62 staleness self-test checks; a GitHub Actions workflow for Node 20 and 22.

### Known limitations

- Not an installable package: adopt it by replacing the example model in `src/model/`.
- Trace validation needs git, `sh` and `tar` (no plain Windows).
- No agent orchestration, Linear or Figma integration, evidence ingestion or formal verification. See ROADMAP.md.
