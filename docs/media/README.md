# Demonstration media

Captured from the live viewer running the bundled example with scripts/record-demo.mjs on 2026-11-27; real clicks; not edited.

The files listed here are produced at the release build: they are recorded after the trace is pinned and committed on their own (see [RELEASING.md](../RELEASING.md)). A checkout of an earlier commit has only this file.

The clips are Chrome's own screencast of the page (1440×900 viewport, light theme, fresh browser profile). One thing is added to the page while a clip is recorded: a small round pointer marker that follows the mouse, because headless Chrome draws no cursor. The stills are page screenshots without it. Each GIF has an MP4 of the same recording next to it.

| File | Duration | Dimensions | What it shows |
|---|---|---|---|
| `demo-model.gif` | 23.8 s | 1200×750, 10 fps | The overview, journey J01 expanded in place, the Booking hold component focused, the state "Room held" with its rules and sources, D-08 and AC-J01-07 opened to their original wording, then the OPEN event "No answer: hold kept" and its question Q-01. |
| `demo-model.mp4` | 23.8 s | 1440×900, 30 fps, H.264 yuv420p | The same recording as `demo-model.gif`. |
| `demo-trace.gif` | 28.8 s | 1200×750, 10 fps | The Trace section of "Room held" (product approval, handoff SR-03 pinned at v1, design, verification with scenario definitions and "No check run recorded"), then the event "No answer: hold given up" with the checked gap G-03, finding XLF-01 and draft work item WI-01, then the "Since pinned" block of "Room held" marked "Needs review" after handoff v1 → v2. |
| `demo-trace.mp4` | 28.8 s | 1440×900, 30 fps, H.264 yuv420p | The same recording as `demo-trace.gif`. |
| `demo-scenario.gif` | 18.8 s | 1200×750, 10 fps | The scenario list, then scenario S01 "A room for six, booked in one go" played through its 9 steps with "Next", across J01, Room search and Booking hold. |
| `demo-scenario.mp4` | 18.8 s | 1440×900, 30 fps, H.264 yuv420p | The same recording as `demo-scenario.gif`. |
| `overview.png` | still | 1440×900 | The overview map with its details panel, light theme. |
| `overview-dark.png` | still | 1440×900 | The same overview after the theme button is set to Dark. |
| `component.png` | still | 1440×900 | The Booking hold component focused, with "Room held" selected and its rules and sources in the panel. |
| `trace.png` | still | 1440×900 | The Trace layers of "Room held": product approval, handoff (pinned version), design, implementation and verification. |
| `open-point.png` | still | 1440×900 | Open question Q-01 with its two alternatives, and both OPEN events emphasised on the map. |

To record again (needs Google Chrome, ffmpeg and playwright-core; see the header of `scripts/record-demo.mjs`):

```
npm run trace-staleness
npm run build && npm run preview -- --port 4321          # in one terminal
npm i --no-save playwright-core
node scripts/record-demo.mjs http://localhost:4321/ docs/media
```

Durations change slightly from one run to the next. The dates and commit ids on screen follow the repository state at the time of recording: the published media was recorded after the trace was pinned, in a commit that changes only this folder, so the baseline id shown is the commit the example trace pins.
