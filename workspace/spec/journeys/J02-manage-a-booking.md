# J02 Manage a booking

| | |
|---|---|
| **Version** | 2 |
| **Review status** | Not started |

The organiser has a booking. Before it starts they may move it or cancel it. On the day they check in, or the room is released; the meeting ends at its end time or earlier.

## Acceptance criteria

| Id | Criterion | From | Note |
|---|---|---|---|
| AC-J02-01 | Only the organiser is offered "Change" and "Cancel" on a booking. | D-12, D-13 | |
| AC-J02-02 | Changing opens a search filled in with the booking's current date, time, length and number of people. | D-04, D-12 | |
| AC-J02-03 | The original room and period stay booked until the new ones are confirmed. | D-12 | |
| AC-J02-04 | When the new room and period are confirmed, the original ones are free at once, and the booking keeps its title and attendees. | D-12, D-22 | Reworded in version 2 to name what carries over. |
| AC-J02-05 | If the hold on the new room and period ends or is released, the booking is as it was. | D-08, D-11, D-12 | |
| AC-J02-06 | Cancelling asks for confirmation and names the meeting. | D-14 | |
| AC-J02-07 | After a cancellation the room is offered to others for that period. | D-13 | |
| AC-J02-08 | Check-in is offered from the start of the check-in window, at the room and from the booking. | D-15, PN-02 | |
| AC-J02-09 | A booking with no check-in by the end of the grace period is released, and the organiser is told. | D-16, D-17, PN-03 | The grace period has no value yet: Q-03. |
| AC-J02-10 | A reminder reaches the organiser before the start. | D-18 | |
| AC-J02-11 | Ending a meeting early frees the room for the time that is left. | D-19 | Does not say who or what ends it. |
| AC-J02-12 | At the end time the booking ends. Nobody is prompted to leave. | D-20 | |
