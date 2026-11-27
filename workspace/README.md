# Example workspace

A small, invented workspace for the bundled example: booking a meeting room in an office. Nothing here describes a real product or organisation.

| Folder | What it holds | Read by |
|---|---|---|
| `spec/` | The source documents: decisions, journeys with acceptance criteria, parameters, follow-ups, open questions | `npm run extract-sources` |
| `handoffs/room-booking/v1`, `v2` | Two versions of a handoff from product to design for one slice | `npm run validate:trace`, `npm run trace-staleness` |
| `handoffs/room-booking/design/v1` | The design return for handoff v1: a design map and findings | the same |

The trace in `trace/example.json` is pinned to handoff **v1**. Handoff v2 changes two of the rows the trace points at, so `npm run trace-staleness` has something real to report.

To use your own workspace, set `LOOM_WORKSPACE` to its folder, or edit `loom.config.ts`.
