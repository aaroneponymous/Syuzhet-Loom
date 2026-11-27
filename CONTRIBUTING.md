# Contributing to Syuzhet Loom

Thanks for looking. Syuzhet Loom is young (v0.1.0) and maintained by one person, so small, focused contributions are the easiest to review.

## Getting set up

Needs Node.js 20 or newer.

```bash
git clone <your fork>
cd syuzhet-loom
npm ci
npm test          # model validation, trace validation, self-tests, type-check
npm run dev       # viewer at http://localhost:5173
```

`npm test` must pass before you open a pull request. CI runs the same command plus `npm run build` on Node 20 and 22.

## What makes a good first contribution

- A bug in the validator, the trace validator or the staleness report, with a failing self-test case that shows it.
- A viewer fix (layout, keyboard access, dark theme contrast).
- Documentation that was wrong or missing when you tried to follow it.
- Anything labelled `good first issue`.

Larger changes (schema changes, new reference schemes, packaging, integrations) are welcome, but open an issue first so we can agree on the shape. See [ROADMAP.md](ROADMAP.md) for what is planned.

## Rules that keep Syuzhet Loom honest

These are the project's design constraints, not style preferences. A change that breaks one will be asked to change.

1. **The viewer renders the model; it never hard-codes behaviour.** Product content belongs in `src/model/`, not in viewer code.
2. **Undecided behaviour stays open.** The model, the example and the tests never resolve an open question by guessing. Draw the documented alternatives and mark them OPEN.
3. **References stay pinned.** A trace endpoint names the exact revision it was checked against. Tooling must not silently re-point a reference to a newer version.
4. **No status is inferred from another.** A definition is not a run; a link is not an approval; a passing structural check is not a correctness claim.
5. **Checks say what they establish.** If you add a check, document what a pass does and does not show.
6. **No network requests from the viewer.** It must work offline after `npm ci`.

## Changing the schema or the hash

Element hashes are computed from the canonical JSON of each element. Changing `src/model/types.ts`, `src/model/dsl.ts` or `src/trace/hash.ts` can change every recorded hash. Such a change needs: a note in the pull request, updated self-tests, and a migration note in the release notes.

## Tests

- `npm run test:trace`: invalid trace data must be rejected; element hashes must be stable.
- `npm run test:staleness`: fixtures for the staleness report.
- Add a case for every bug fix. Do not delete a case to make a change pass; if a case no longer applies, say why in the pull request.

## Pull requests

- One topic per pull request, with a description of what changed and how you checked it.
- Paste the last lines of `npm test`.
- Do not commit `node_modules/`, `dist/`, local response logs, credentials or `.env` files.
- By contributing you agree that your contribution is licensed under the project's licence (see `LICENSE`).

## Reporting security problems

Do not open a public issue. See [SECURITY.md](SECURITY.md).
