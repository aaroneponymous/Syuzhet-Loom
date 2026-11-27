# Decision register: meeting-room booking (example)

Version 2. Invented for the Syuzhet Loom example. A decision keeps its id for good; a changed decision is superseded, not edited.

## Decisions

| Id | Decision | Why |
|---|---|---|
| D-01 | A booking is for one room and one continuous period on one day. | Keeps "is the room free?" a question with one answer. |
| D-02 | A room holds at most one booking at any moment. Bookings never overlap. | This is the promise the whole product rests on. |
| D-03 | Anyone in the office directory can book any room. There is no approval step. | Booking has to be quicker than walking the corridor to look. |
| D-04 | A search asks for the date, the start time, the length and the number of people. Only rooms that are large enough and free for the whole period are listed. | People should never pick a room they cannot have. |
| D-05 | When no room matches, the person is told "Nothing free" and can change what they asked for. This is an ordinary result, not an error. | A full office is not a fault. |
| D-06 | Picking a room places a hold on that room and period before any details are asked for. | Typing a title must not cost someone the room. |
| D-07 | A hold belongs to one person and keeps the room and period from everyone else while it lasts. | Two people must never both believe they have the room. |
| D-08 | A hold that is not confirmed ends by itself when the hold period (PN-01) has passed. | Abandoned holds must not block rooms. |
| D-09 | If someone else takes the room before the hold can be placed, the person goes back to the list of rooms, brought up to date, and is told why. | Losing a race should cost one tap, not a new search. |
| D-10 | A booking exists only once the person confirms. A hold is never shown to anyone as a booking. | Colleagues plan around bookings; they must be real. |
| D-11 | Backing out before confirming releases the hold at once. | The room should be free again the moment it is not wanted. |
| D-12 | The organiser can move a booking to another time or room. The original room and period stay booked until the new ones are confirmed. | Nobody should lose a room by trying for a better one. |
| D-13 | The organiser can cancel a booking that has not started. The room is free again at once. | Unused rooms are the main complaint. |
| D-14 | Cancelling asks for confirmation and names the meeting. | A cancelled meeting cannot be brought back if the room is taken. |
| D-15 | Check-in opens a short time before the start (PN-02) and can be done at the room or from the booking. | It shows the room is really going to be used. |
| D-16 | A booking that is not checked in by the end of the grace period (PN-03) is released, and the room is free for the rest of the period. | No-shows waste the scarcest rooms. |
| D-17 | The organiser is told when their booking has been released for not checking in. | A release must never be a surprise found at the door. |
| D-18 | The organiser gets a reminder before the start. | Most no-shows are forgotten meetings. |
| D-19 | A meeting that ends early frees the room for the time that is left. | Short meetings should give time back. |
| D-20 | A booking ends at its end time. The system asks nobody to leave. | The product manages bookings, not people. |
| D-21 | The list of rooms shows what was free when the search ran, and says when that was. It is brought up to date only when the person searches again or loses a race for a room. | Added in version 2. A list that changes under the finger causes wrong taps. |
| D-22 | Moving a booking keeps the same booking: its title and attendees carry over. | Added in version 2. A move is not a cancel followed by a new booking. |

## Deferred

| Id | Deferred | Note |
|---|---|---|
| DF-01 | Bookings that repeat (a weekly series). | Belongs to journey J06, which is not written. Until then every booking stands alone. |
