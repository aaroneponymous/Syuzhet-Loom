# Handoffs (example)

A handoff is what product gives design for one slice of the product: requirements, not screens. The layout below is the contract the trace tools read.

```
handoffs/<slice>/vN/HANDOFF.md        what this version is; a table row "| **Version** | vN |"
handoffs/<slice>/vN/WORKFLOWS.md      scenarios, one table row per id: | SCN-nn | … |
handoffs/<slice>/vN/SCREEN_SPEC.md    requirements, one table row per id: | SR-nn | … | and | IX-nn | … |
handoffs/<slice>/vN/CHANGES.md        from v2 on: what changed since the version before, one row per id
handoffs/<slice>/design/vN/DESIGN_MAP.md   the design return for handoff vN; a line "Handoff used: `handoffs/<slice>/vN/`"; one row per id designed
handoffs/<slice>/design/vN/FINDINGS.md     what the designer found missing or unclear
```

A version folder is not edited once it has been given to the designer. A change makes a new version. That is what lets a trace pin `handoff:room-booking/v1#IX-06` and still mean the same text after v2 exists.

Everything under `room-booking/` is invented for the Syuzhet Loom example.
