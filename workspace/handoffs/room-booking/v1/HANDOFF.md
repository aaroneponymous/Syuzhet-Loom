# Handoff: room booking

| | |
|---|---|
| **Version** | v1 |
| **Slice** | room-booking: journey J01 from picking a room to a confirmed booking |
| **Status** | Draft for design. Not accepted. |
| **Sources** | `spec/DECISION_REGISTER.md` version 2, `spec/journeys/J01-book-a-room.md` version 2 |

Invented for the Syuzhet Loom example. It shows the shape of a handoff; it is not a real product document.

## What design is asked for

Screens and interactions for the rows in `SCREEN_SPEC.md`, checked against the scenarios in `WORKFLOWS.md`.

## What is not decided

- Q-01: what happens to the hold when no answer comes back after confirming. IX-07 covers a clear failure only. Do not design the "no answer" case until Q-01 is answered.
