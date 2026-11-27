# Changes: room booking, v1 to v2

| Id | Change | Before | After | Source |
|---|---|---|---|---|
| SR-03 | changed | Time left shown in whole minutes. | Time left shown in minutes and seconds, with the last minute marked as a warning. | Design finding F-01: a whole-minute count shows "0 minutes" for the last 59 seconds. |
| IX-06 | changed | Message, then back to the room list. | Message with the action "Search again" (IX-08); back to the room list when dismissed. | D-21: the list is not brought up to date by itself, so a list shown after five minutes may be stale. |
| IX-08 | new | — | Runs the same search again from the "hold ran out" message. | D-21 |

Unchanged: SR-01, SR-02, SR-04, IX-01 to IX-05, IX-07, SCN-01 to SCN-03.
