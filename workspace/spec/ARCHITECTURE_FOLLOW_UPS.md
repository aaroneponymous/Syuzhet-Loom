# Architecture follow-ups: meeting-room booking (example)

Things the decisions require of whatever is built. They are requirements on a design that does not exist yet, not a design.

| Id | Follow-up | Comes from | Status |
|---|---|---|---|
| AF-01 | Holds and bookings for a room must be decided in one place, so that two requests for the same room and period cannot both succeed. | D-02, D-07, D-09 | Status: open |
| AF-02 | Confirming must be safe to repeat: sending the same confirmation twice creates one booking, and the sender can find out afterwards whether it was recorded. | D-02, D-10 | Status: open |
| AF-03 | Hold expiry and no-show release must run on the service's clock, not on a person's device. | D-08, D-16 | Status: open |
