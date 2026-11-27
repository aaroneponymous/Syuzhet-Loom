import { final, initial, machine, s, t } from '../dsl';
import type { MachineDef } from '../types';

// ---------------------------------------------------------------------------
// J01 Book a room
// ---------------------------------------------------------------------------
export const j01: MachineDef = machine({
  id: 'j01',
  title: 'J01 Book a room',
  kind: 'journey',
  summary: 'Say what is needed, pick a room, confirm while it is held.',
  description: 'The journey is short on purpose: search, then a hold that becomes a booking. Both steps are shared components, because moving a booking (J02) uses them too.',
  refs: ['D-01', 'D-03'],
  entries: { default: 'searching' },
  states: [
    initial(),
    s('searching', 'Finding a room', { uses: 'room-search', description: 'The person says when, for how long and for how many, and picks from the rooms that fit.', refs: ['D-04'] }),
    s('reserving', 'Reserving the room', {
      uses: 'booking-hold',
      description: 'The room picked is held while the person adds a title and attendees, and becomes a booking when they confirm.',
      refs: ['D-06', 'D-10'],
    }),
    final('booked', 'Room booked', { description: 'The booking exists and is listed for the organiser as upcoming.', refs: ['D-10', 'AC-J01-12'] }),
    final('left', 'Left without booking', { description: 'Nothing was booked and nothing is held.', refs: ['D-05', 'D-11'] }),
  ],
  transitions: [
    t('start', 'searching', 'Need a room', { actor: 'user', flow: 'main', refs: ['D-03'] }),
    t('searching', 'reserving', 'Room picked', {
      fromExit: 'chosen',
      actor: 'user',
      flow: 'main',
      effects: ['A hold is asked for on the room and period picked.'],
      refs: ['D-06', 'AC-J01-04'],
    }),
    t('reserving', 'booked', 'Booking confirmed', { fromExit: 'booked', actor: 'app', flow: 'main', refs: ['D-10', 'AC-J01-09', 'AC-J01-12'] }),
    t('reserving', 'searching', 'Room just taken', {
      fromExit: 'lost',
      toEntry: 'results',
      actor: 'app',
      flow: 'side',
      description: 'Someone else got the room first. The person lands on the list of rooms, brought up to date, and is told why.',
      refs: ['D-09', 'AC-J01-06'],
    }),
    t('reserving', 'searching', 'Hold ran out', {
      fromExit: 'expired',
      toEntry: 'results',
      actor: 'time',
      flow: 'side',
      description: 'The hold period passed without a confirmation. Nothing was booked; the person is told and can pick again.',
      refs: ['D-08', 'AC-J01-08'],
      interpretation: 'The sources say the person is told and nothing was booked. That they land on the list of rooms, rather than on an empty search, is assumed from D-09.',
    }),
    t('reserving', 'searching', 'Pick another room', { fromExit: 'released', toEntry: 'results', actor: 'user', flow: 'side', refs: ['D-11', 'AC-J01-10'] }),
    t('searching', 'left', 'Give up', { actor: 'user', flow: 'side', description: 'From anywhere in the search, including "Nothing free".', refs: ['D-05'] }),
  ],
});

// ---------------------------------------------------------------------------
// Room search: used by J01, and by J02 when a booking is moved
// ---------------------------------------------------------------------------
export const roomSearch: MachineDef = machine({
  id: 'room-search',
  title: 'Room search',
  kind: 'shared',
  summary: 'Ask for a date, time, length and size; get the rooms that fit and are free.',
  refs: ['D-04', 'D-05', 'D-21'],
  entries: { default: 'criteria', results: 'results' },
  exits: { chosen: 'chosen' },
  states: [
    s('criteria', 'Setting criteria', {
      description: 'Date, start time, length and number of people. When a booking is being moved, these start filled in with its current values.',
      rules: ['A search cannot start until all four are given.'],
      refs: ['D-04', 'AC-J01-01', 'AC-J02-02'],
    }),
    s('checking', 'Checking rooms', { description: 'The rooms that are large enough and free for the whole period are being looked up.', refs: ['D-04'] }),
    s('results', 'Rooms listed', {
      description: 'The rooms that fit, as they were when the search ran.',
      rules: ['Every room listed is large enough and free for the whole period.', 'A room someone else is holding is not listed.', 'The list says when it was fetched. It does not change by itself.'],
      refs: ['D-02', 'D-04', 'D-07', 'D-21', 'AC-J01-02', 'AC-J01-05', 'AC-J01-14'],
    }),
    s('nothing-free', 'Nothing free', {
      description: 'No room matches. This is an ordinary result: the person is told plainly and offered a way to change what they asked for.',
      rules: ['No error is shown.'],
      refs: ['D-05', 'AC-J01-03'],
    }),
    final('chosen', 'Room chosen', { description: 'A room and a period have been picked. Nothing is held or booked yet.', refs: ['D-06'] }),
  ],
  transitions: [
    t('criteria', 'checking', 'Search', { actor: 'user', flow: 'main', guard: 'Date, start time, length and number of people are all given.', refs: ['D-04', 'AC-J01-01'] }),
    t('checking', 'results', 'Rooms found', { actor: 'app', flow: 'main', refs: ['D-04', 'AC-J01-02'] }),
    t('checking', 'nothing-free', 'No room fits', { actor: 'app', flow: 'side', refs: ['D-05', 'AC-J01-03'] }),
    t('nothing-free', 'criteria', 'Change criteria', { actor: 'user', flow: 'side', refs: ['D-05', 'AC-J01-03'] }),
    t('results', 'criteria', 'Change criteria', { actor: 'user', flow: 'side', refs: ['D-04'] }),
    t('results', 'checking', 'Search again', { actor: 'user', flow: 'side', description: 'The only way the list is brought up to date while the person is looking at it.', refs: ['D-21'] }),
    t('results', 'chosen', 'Pick a room', { actor: 'user', flow: 'main', refs: ['D-06', 'AC-J01-04'] }),
  ],
});

// ---------------------------------------------------------------------------
// Booking hold: a room is held first and becomes a booking on confirmation
// ---------------------------------------------------------------------------
export const bookingHold: MachineDef = machine({
  id: 'booking-hold',
  title: 'Booking hold',
  kind: 'shared',
  summary: 'A room is held for one person, then confirmed into a booking, lost, released or left to run out.',
  description:
    'The same component reserves a room for a new booking (J01) and for a booking being moved (J02). A hold is not a booking: only confirming creates or moves one.',
  refs: ['D-06', 'D-07', 'D-08', 'D-10', 'D-11'],
  entries: { default: 'placing' },
  exits: { booked: 'booked', lost: 'lost', expired: 'expired', released: 'released' },
  interpretations: [
    'The hold period is drawn as running from the moment the hold is placed and not pausing while a confirmation is in flight. D-08 gives the period but not its starting point; "placed" is the reading that makes AC-J01-07 (time left is shown) checkable.',
  ],
  states: [
    s('placing', 'Placing hold', {
      description: 'The hold has been asked for and the answer is not in yet.',
      refs: ['D-06', 'D-07'],
      interpretation: 'The sources speak of a hold being placed as if it were instant. This state is added so that losing the room to someone else (D-09) has a moment in which to happen.',
    }),
    s('held', 'Room held', {
      description: 'The room and period are kept from everyone else while the person adds a title and attendees.',
      rules: [
        'Nobody else is offered this room for an overlapping period.',
        'The time left on the hold is shown.',
        'The hold is never shown to anyone as a booking, and no wording calls it one.',
      ],
      refs: ['D-07', 'D-08', 'D-10', 'PN-01', 'AC-J01-05', 'AC-J01-07', 'AC-J01-13'],
    }),
    s('confirming', 'Confirming', {
      description: 'The person has confirmed and the outcome is not known yet.',
      rules: ['Pressing confirm again does not create a second booking.'],
      refs: ['D-02', 'D-10', 'AC-J01-09'],
    }),
    final('booked', 'Booked', { description: 'The booking exists (or, for a move, now has its new room and period). The hold is gone because it became the booking.', refs: ['D-10', 'AC-J01-09'] }),
    final('lost', 'Room taken', { description: 'Someone else got the room before the hold could be placed. Nothing is held.', refs: ['D-09', 'AC-J01-06'] }),
    final('expired', 'Hold ran out', { description: 'The hold period passed without a confirmation. Nothing was booked.', refs: ['D-08', 'PN-01', 'AC-J01-08'] }),
    final('released', 'Hold released', { description: 'The person backed out. The room is free again at once.', refs: ['D-11', 'AC-J01-10'] }),
  ],
  transitions: [
    t('placing', 'held', 'Hold placed', { actor: 'app', flow: 'main', effects: ['The hold period starts.'], refs: ['D-06', 'D-07', 'AC-J01-04'] }),
    t('placing', 'lost', 'Someone was first', { actor: 'app', flow: 'side', refs: ['D-07', 'D-09', 'AC-J01-06'] }),
    t('held', 'confirming', 'Confirm', { actor: 'user', flow: 'main', refs: ['D-10', 'AC-J01-09'] }),
    t('held', 'expired', 'Hold period ends', { actor: 'time', flow: 'side', effects: ['The room is free again.', 'The person is told that nothing was booked.'], refs: ['D-08', 'PN-01', 'AC-J01-08'] }),
    t('held', 'released', 'Back out', { actor: 'user', flow: 'side', effects: ['The room is free again at once.'], refs: ['D-11', 'AC-J01-10'] }),
    t('confirming', 'booked', 'Booking recorded', { actor: 'app', flow: 'main', effects: ['Exactly one booking exists for this hold.'], refs: ['D-02', 'D-10', 'AC-J01-09'] }),
    t('confirming', 'held', 'Confirming failed', {
      id: 'confirming__held',
      actor: 'app',
      flow: 'side',
      description: 'The answer was a clear "not recorded". The hold is still there and the person can try again while it lasts.',
      refs: ['D-08', 'D-10', 'AC-J01-11'],
    }),
    t('confirming', 'held', 'No answer: hold kept', {
      id: 'confirming__held-unknown',
      actor: 'app',
      flow: 'side',
      description: 'Alternative (a) of Q-01: with no answer, the hold stays until its period ends and the person can confirm again.',
      refs: ['D-08', 'AC-J01-11'],
      open: { questions: ['Q-01'], note: 'Whether the hold is still the person\'s when no answer comes back is not decided. This path is alternative (a).' },
    }),
    t('confirming', 'expired', 'No answer: hold given up', {
      id: 'confirming__expired',
      actor: 'app',
      flow: 'side',
      description: 'Alternative (b) of Q-01: with no answer, the hold is given up and the person starts again from the list.',
      refs: ['D-08', 'AC-J01-11'],
      open: { questions: ['Q-01'], note: 'Whether the hold is still the person\'s when no answer comes back is not decided. This path is alternative (b).' },
    }),
  ],
});

export const bookingMachines: MachineDef[] = [j01, roomSearch, bookingHold];
