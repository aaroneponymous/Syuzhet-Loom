# Security policy

## Supported versions

Syuzhet Loom is pre-1.0. Only the latest release receives fixes.

## Reporting a vulnerability

Please report privately through GitHub: **Security → Report a vulnerability** on this repository (private vulnerability reporting). Do not open a public issue for a suspected vulnerability.

Include what you did, what happened, and the version or commit. You should get a first reply within seven days. This is a single-maintainer project, so fixes are best effort.

## What is in scope

- The development server hook that writes the local response log (`responses-plugin.ts`): it accepts writes from the browser and writes files on the machine running `npm run dev` or `npm run preview`.
- Scripts that read files and run `git` on paths taken from trace data (`scripts/validate-trace.ts`, `scripts/trace-staleness.ts`, `scripts/pinned-model.ts`).
- Anything in the viewer that renders model or trace text as markup.

## Things to know when you use Syuzhet Loom

- **Run it locally.** The dev and preview servers are meant for `localhost`. They have no authentication; do not expose them to a network you do not trust.
- **Treat models and traces from others as code.** A model is TypeScript that is executed when it is loaded, and trace validation loads the model as it was at a pinned commit. Only validate repositories you trust.
- **The viewer makes no network requests** after installation. If you see one, report it.
- **Your model may be confidential.** Syuzhet Loom stores product behaviour, decisions and quoted source wording in the repository. Check what you publish.
