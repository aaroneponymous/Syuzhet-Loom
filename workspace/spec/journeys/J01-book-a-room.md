# J01 Book a room

| | |
|---|---|
| **Version** | 2 |
| **Review status** | Not started |

A person needs a room for a meeting. They say when, for how long and for how many people; they pick a room; the room is held while they add the details; they confirm.

## Acceptance criteria

| Id | Criterion | From | Note |
|---|---|---|---|
| AC-J01-01 | A search cannot start until the date, start time, length and number of people are given. | D-04 | |
| AC-J01-02 | Every room listed is large enough and free for the whole period asked for. | D-02, D-04 | |
| AC-J01-03 | When no room matches, "Nothing free" is shown with a way to change the criteria. No error is shown. | D-05 | |
| AC-J01-04 | Picking a room places a hold before the details step is shown. | D-06 | |
| AC-J01-05 | While a hold lasts, nobody else is offered that room for an overlapping period. | D-07 | |
| AC-J01-06 | If the room was taken first, the person is returned to the list, brought up to date, and told the room has just been taken. | D-09 | |
| AC-J01-07 | The details step shows how much of the hold period is left. | D-08, PN-01 | |
| AC-J01-08 | When the hold period ends without confirmation, the hold is gone, the person is told, and nothing was booked. | D-08 | |
| AC-J01-09 | Confirming creates exactly one booking, however many times the person presses. | D-02, D-10 | |
| AC-J01-10 | Leaving the details step releases the hold at once. | D-11 | |
| AC-J01-11 | If confirming fails, the person can try again for as long as the hold lasts. | D-08, D-10 | Does not say what happens when no answer comes back at all: Q-01. |
| AC-J01-12 | After confirming, the booking is listed for the organiser as upcoming. | D-10 | |
| AC-J01-13 | No wording shown to the person calls a hold a booking. | D-10 | Wording rule. |
| AC-J01-14 | The list of rooms says when it was fetched. | D-21 | Added in version 2. |
