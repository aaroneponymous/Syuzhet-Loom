# Screen specification: room booking, v2

Requirements for the screens and interactions of journey J01, from picking a room to a confirmed booking. The "Model" column names the model element a row details, as `machine/element`. "Class" says where a row comes from: **confirmed** (a decision or criterion says it), **derived** (follows from one), **open** (waits for a question).

## Screens and states

| Id | Surface | Requirement | Model | Sources | Class |
|---|---|---|---|---|---|
| SR-01 | Room list | Lists the rooms that fit, each with its size and floor. States when the list was fetched. | `room-search/results` | D-04, D-21, AC-J01-02, AC-J01-14 | confirmed |
| SR-02 | Placing hold | A short waiting state between picking a room and the details step. No details can be typed yet. | `booking-hold/placing` | D-06 | derived |
| SR-03 | Details step | Fields for the title and the attendees. Shows the time left on the hold, in minutes and seconds, and marks the last minute as a warning. Never calls the hold a booking. | `booking-hold/held` | D-07, D-08, PN-01, AC-J01-07, AC-J01-13 | confirmed |
| SR-04 | Booking confirmed | Shows the room, the period and the title, and leads to the booking in the organiser's list. | `booking-hold/booked` | D-10, AC-J01-12 | confirmed |

## Interactions

| Id | Action | Requirement | Model | Sources | Class |
|---|---|---|---|---|---|
| IX-01 | Search | Enabled only when the date, start time, length and number of people are all given. | `room-search/criteria__checking` | D-04, AC-J01-01 | confirmed |
| IX-02 | Pick a room | Asks for a hold on that room and period and shows "Placing hold". | `room-search/results__chosen` | D-06, AC-J01-04 | confirmed |
| IX-03 | Hold placed | Moves on to the details step by itself. | `booking-hold/placing__held` | D-06, AC-J01-04 | confirmed |
| IX-04 | Room just taken | Returns to the room list, brought up to date, with the message "That room has just been taken." | `booking-hold/placing__lost` | D-09, AC-J01-06 | confirmed |
| IX-05 | Confirm | Sends the confirmation once. The button cannot be pressed a second time while the outcome is awaited. | `booking-hold/held__confirming` | D-10, AC-J01-09 | confirmed |
| IX-06 | Hold runs out | Shows "Your hold ran out. Nothing was booked." with the action "Search again" (IX-08), and returns to the room list when dismissed. | `booking-hold/held__expired` | D-08, AC-J01-08 | confirmed |
| IX-07 | Try again | When confirming fails, shows why and offers "Try again" for as long as the hold lasts. | — | D-08, AC-J01-11 | open |
| IX-08 | Search again | From the "hold ran out" message: runs the same search again and shows the new list. | `room-search/results__checking` | D-21 | derived |
