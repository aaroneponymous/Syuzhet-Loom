import type { NonVisualRule, OpenQuestion } from './types';

// Unresolved behaviour, open points, discrepancies and ambiguities.
// The model never resolves these. Elements they touch carry an `open` mark.
export const openQuestions: OpenQuestion[] = [
  {
    id: 'Q-01',
    title: 'No answer after confirming: is the hold kept?',
    status: 'unresolved',
    question:
      'The person confirms and no answer comes back, for example because the connection drops. D-08 ends a hold only when its period has passed, and AC-J01-11 lets the person try again "if confirming fails". Neither says whether the hold is still theirs while the outcome is simply unknown.',
    options: [
      '(a) The hold is kept until its period ends, and the person can confirm again.',
      '(b) The hold is given up, and the person starts again from the list of rooms.',
    ],
    decisions: ['D-08', 'D-10'],
    journeys: ['J01', 'J02'],
    handling: 'Both alternatives are drawn out of "Confirming" in the Booking hold component, dashed and marked OPEN.',
  },
  {
    id: 'Q-02',
    title: 'Changing a booking that has started',
    status: 'unresolved',
    question:
      'D-12 lets the organiser move a booking and D-13 limits cancelling to bookings that have not started. Nothing says whether a booking that has already started can still be changed, for example made longer.',
    options: ['(a) No: a started booking can only end early (D-19).', '(b) Yes: it can be made longer if the room is free afterwards.'],
    decisions: ['D-12', 'D-13', 'D-19'],
    journeys: ['J02'],
    handling: 'Alternative (b) is drawn as a dashed "Make it longer" path in J02, marked OPEN. Under (a) that path does not exist.',
  },
  {
    id: 'Q-03',
    title: 'Length of the grace period',
    status: 'parameter',
    question: 'D-16 releases a booking with no check-in "by the end of the grace period". PN-03 names the period and has no value yet.',
    decisions: ['D-16'],
    journeys: ['J02'],
    handling: 'The model draws the release as an event caused by time and cites PN-03. "Check-in open" carries an OPEN mark for its unknown length.',
  },
];

// Acceptance criteria that constrain wording or something that never happens. They are recorded as a rule
// on the nearest element instead of being drawn as their own state or transition.
export const nonVisualRules: NonVisualRule[] = [
  { id: 'AC-J01-13', reason: 'A rule about wording: no text calls a hold a booking. There is no state or event to draw.' },
  { id: 'AC-J02-03', reason: 'Something that stays true throughout a move (the original slot remains booked), not a step of its own.' },
];
