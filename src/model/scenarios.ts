// Worked scenarios that can be played on the map, step by step.
// Each step points at one state or event in one machine. A scenario is a reading aid: it shows a path the
// source documents describe and does not add behaviour.
import type { RefId } from './types';

export interface ScenarioStep {
  /** machine the step is in */
  machine: string;
  /** state id or transition id within that machine */
  element: string;
  /** what happens at this step, in one or two plain sentences */
  note: string;
}
export interface Scenario {
  id: string; // 'S01', 'S02', ...
  title: string;
  /** one sentence: the situation */
  summary: string;
  /** where the scenario comes from, e.g. a review session or a walkthrough document */
  source: string;
  /** 'consistent': the documents cover every step. 'gap': the scenario ends at something undecided. */
  outcome: 'consistent' | 'gap';
  /** open-question ids the scenario runs into */
  questions?: RefId[];
  steps: ScenarioStep[];
}

const step = (machine: string, element: string, note: string): ScenarioStep => ({ machine, element, note });

export const scenarios: Scenario[] = [
  {
    id: 'S01',
    title: 'A room for six, booked in one go',
    summary: 'Someone needs a room for six people for an hour on Thursday and gets one.',
    source: 'Written for the example from journey J01',
    outcome: 'consistent',
    steps: [
      step('j01', 'start__searching', 'They open booking with a meeting in mind.'),
      step('room-search', 'criteria__checking', 'They give Thursday, 14:00, one hour, six people, and search.'),
      step('room-search', 'results', 'Three rooms are listed. Each is large enough and free for the whole hour.'),
      step('room-search', 'results__chosen', 'They pick the room on the second floor.'),
      step('booking-hold', 'placing__held', 'The room is held for them. Nobody else is offered it for that hour.'),
      step('booking-hold', 'held', 'They type a title and add attendees. The time left on the hold is shown.'),
      step('booking-hold', 'held__confirming', 'They confirm.'),
      step('booking-hold', 'confirming__booked', 'Exactly one booking is recorded.'),
      step('j01', 'booked', 'The booking is in their list as upcoming.'),
    ],
  },
  {
    id: 'S02',
    title: 'Two people want the last room',
    summary: 'Two colleagues see the same room listed and pick it within a second of each other.',
    source: 'Written for the example from decisions D-07 and D-09',
    outcome: 'consistent',
    steps: [
      step('room-search', 'results', 'Both see the same room listed: the list shows what was free when each of them searched.'),
      step('room-search', 'results__chosen', 'Both pick it.'),
      step('booking-hold', 'placing', 'Both holds are asked for. Only one can be placed.'),
      step('booking-hold', 'placing__lost', 'The second person was a moment too late.'),
      step('j01', 'reserving__searching', 'They land back on the list, brought up to date, and are told the room has just been taken.'),
      step('room-search', 'results', 'The room is no longer listed. They pick from what is left.'),
    ],
  },
  {
    id: 'S03',
    title: 'Confirm pressed in a lift',
    summary: 'The connection drops just as the person confirms, and no answer comes back.',
    source: 'Written for the example from acceptance criterion AC-J01-11',
    outcome: 'gap',
    questions: ['Q-01'],
    steps: [
      step('booking-hold', 'held', 'The room is held and the details are filled in.'),
      step('booking-hold', 'held__confirming', 'They confirm as the lift doors close.'),
      step('booking-hold', 'confirming', 'No answer comes back. Whether a booking was recorded is not known.'),
      step('booking-hold', 'confirming__held-unknown', 'The documents do not say what happens to the hold now. One reading keeps it; the other gives it up. The scenario stops here.'),
    ],
  },
  {
    id: 'S04',
    title: 'Moving a meeting, then nobody turns up',
    summary: 'An organiser moves a booking to a larger room, forgets the meeting, and the room is released.',
    source: 'Written for the example from journey J02',
    outcome: 'consistent',
    steps: [
      step('j02', 'viewing__choosing-slot', 'The organiser chooses "Change". The search opens with the booking\'s current values.'),
      step('j02', 'choosing-slot__moving', 'They pick a larger room at the same time.'),
      step('j02', 'moving', 'The new room is held. The original room is still booked.'),
      step('j02', 'moving__moved', 'They confirm. The original room is free at once; the title and attendees carried over.'),
      step('booking', 'upcoming__upcoming', 'It is the same booking, with a new room.'),
      step('check-in', 'not-open__open', 'On the day, check-in opens shortly before the start.'),
      step('check-in', 'open__missed', 'Nobody checks in, and the grace period ends.'),
      step('meeting-day', 'presence__record_2', 'The missed check-in releases the booking.'),
      step('booking', 'upcoming__released', 'The room is free for the rest of the period.'),
      step('meeting-day', 'record__messages', 'The organiser is told their booking was released.'),
    ],
  },
];
