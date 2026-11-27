# Workflows: room booking, v1

Scenarios the design is checked against. The "Model path" column names the model elements a scenario walks through, as `machine/element`. A scenario is a definition: nothing here says it has been run.

| Id | Scenario | Steps | Model path |
|---|---|---|---|
| SCN-01 | Booked in one go | Search for a room for six on Thursday at 14:00 for an hour. Pick a room. Add a title. Confirm. The booking is listed as upcoming. | `room-search/results__chosen`, `booking-hold/placing__held`, `booking-hold/held__confirming`, `booking-hold/confirming__booked` |
| SCN-02 | The hold runs out | Pick a room, then leave the details step open until the hold period has passed. The message says nothing was booked, and the room list is shown again. | `booking-hold/placing__held`, `booking-hold/held__expired` |
| SCN-03 | Beaten to the room | Two people pick the same room. The second is returned to the list, which no longer shows the room, and is told why. | `booking-hold/placing__lost` |
