import { final, initial, machine, s, signal, t } from '../dsl';
import type { MachineDef } from '../types';

// ---------------------------------------------------------------------------
// J02 Manage a booking
// ---------------------------------------------------------------------------
export const j02: MachineDef = machine({
  id: 'j02',
  title: 'J02 Manage a booking',
  kind: 'journey',
  summary: 'Move a booking, cancel it, or leave it as it is.',
  description: 'What the organiser can do with a booking before it starts. What happens on the day is drawn separately, in "On the day".',
  refs: ['D-12', 'D-13'],
  entries: { default: 'viewing' },
  states: [
    initial(),
    s('viewing', 'Booking open', {
      description: 'The organiser is looking at one of their bookings.',
      rules: ['Only the organiser is offered "Change" and "Cancel".'],
      refs: ['D-12', 'D-13', 'AC-J02-01'],
    }),
    s('choosing-slot', 'Finding a new slot', {
      uses: 'room-search',
      description: 'The same search as for a new booking, filled in with this booking\'s current values.',
      rules: ['The original room and period stay booked throughout.'],
      refs: ['D-12', 'AC-J02-02', 'AC-J02-03'],
    }),
    s('moving', 'Holding the new slot', {
      uses: 'booking-hold',
      description: 'The new room and period are held and confirmed exactly as for a new booking.',
      rules: ['The original room and period stay booked until the new ones are confirmed.'],
      refs: ['D-12', 'AC-J02-03'],
    }),
    final('moved', 'Booking moved', { description: 'The same booking now has its new room and period. Its title and attendees carried over.', refs: ['D-12', 'D-22', 'AC-J02-04'] }),
    s('cancelling', 'Confirming cancel', { description: 'The organiser is asked to confirm, and the meeting is named.', refs: ['D-14', 'AC-J02-06'] }),
    final('cancelled', 'Booking cancelled', { description: 'The room is free again and is offered to others for that period.', refs: ['D-13', 'AC-J02-07'] }),
    final('kept', 'Left as it was', { description: 'Nothing about the booking changed.', refs: ['D-12', 'AC-J02-05'] }),
  ],
  transitions: [
    t('start', 'viewing', 'Open a booking', { actor: 'user', flow: 'main', refs: ['AC-J02-01'] }),
    t('viewing', 'choosing-slot', 'Change', { actor: 'user', flow: 'main', guard: 'The booking has not started.', refs: ['D-12', 'AC-J02-02'] }),
    t('viewing', 'choosing-slot', 'Make it longer', {
      id: 'viewing__choosing-slot-started',
      actor: 'user',
      flow: 'side',
      guard: 'The booking has started.',
      description: 'Alternative (b) of Q-02: a started booking can be made longer if the room is free afterwards. Under alternative (a) this path does not exist and a started booking can only end early.',
      refs: ['D-12', 'D-19'],
      open: { questions: ['Q-02'], note: 'Whether a booking that has started can be changed at all is not decided. This path exists only under alternative (b).' },
    }),
    t('choosing-slot', 'moving', 'New slot picked', { fromExit: 'chosen', actor: 'user', flow: 'main', refs: ['D-06', 'D-12'] }),
    t('choosing-slot', 'viewing', 'Keep the booking', { actor: 'user', flow: 'side', description: 'From anywhere in the search. The booking is as it was.', refs: ['D-12', 'AC-J02-05'] }),
    t('moving', 'moved', 'New slot confirmed', {
      fromExit: 'booked',
      actor: 'app',
      flow: 'main',
      effects: ['The original room and period are free at once.', 'The booking keeps its title and attendees.'],
      refs: ['D-12', 'D-22', 'AC-J02-04'],
    }),
    t('moving', 'choosing-slot', 'Room just taken', { fromExit: 'lost', toEntry: 'results', actor: 'app', flow: 'side', refs: ['D-09', 'D-12'] }),
    t('moving', 'viewing', 'Hold ran out', { fromExit: 'expired', actor: 'time', flow: 'side', description: 'The booking is as it was.', refs: ['D-08', 'D-12', 'AC-J02-05'] }),
    t('moving', 'viewing', 'Back out', { fromExit: 'released', actor: 'user', flow: 'side', description: 'The booking is as it was.', refs: ['D-11', 'D-12', 'AC-J02-05'] }),
    t('viewing', 'cancelling', 'Cancel', { actor: 'user', flow: 'side', guard: 'The booking has not started.', refs: ['D-13', 'D-14', 'AC-J02-06'] }),
    t('cancelling', 'cancelled', 'Confirm cancel', { actor: 'user', flow: 'side', effects: ['The room is free again at once.'], refs: ['D-13', 'AC-J02-07'] }),
    t('cancelling', 'viewing', 'Keep the booking', { actor: 'user', flow: 'side', refs: ['D-14'] }),
    t('viewing', 'kept', 'Close', { actor: 'user', flow: 'side', refs: ['AC-J02-01'] }),
  ],
});

// ---------------------------------------------------------------------------
// On the day: things that run side by side once a booking is close to its start
// ---------------------------------------------------------------------------
export const meetingDay: MachineDef = machine({
  id: 'meeting-day',
  title: 'On the day',
  kind: 'shared',
  summary: 'Check-in, the booking record and the messages to the organiser, running side by side.',
  description: 'Three things happen alongside each other for one booking. None waits for another; they only inform each other.',
  parallel: true,
  refs: ['D-15', 'D-16', 'D-17', 'D-18'],
  interpretations: [
    'The sources describe check-in, release and messages in separate decisions without saying how they relate. They are drawn as parts that run side by side because no decision makes one wait for another.',
  ],
  states: [
    s('presence', 'Check-in', { uses: 'check-in', multiplicity: 'one per booking', refs: ['D-15'] }),
    s('record', 'Booking', { uses: 'booking', multiplicity: 'one per booking', refs: ['D-16', 'D-19', 'D-20'] }),
    s('messages', 'Messages to organiser', {
      description: 'What the organiser is sent about this booking on the day.',
      rules: ['A reminder is sent before the start.', 'If the booking is released for not checking in, the organiser is told.'],
      refs: ['D-17', 'D-18', 'AC-J02-10'],
    }),
  ],
  transitions: [
    signal('presence', 'record', 'Checked in', { fromExit: 'present', flow: 'main', description: 'The booking becomes "in use".', refs: ['D-15', 'AC-J02-08'] }),
    signal('presence', 'record', 'No check-in', { fromExit: 'absent', flow: 'side', description: 'The booking is released and the room is free for the rest of the period.', refs: ['D-16', 'AC-J02-09'] }),
    signal('record', 'messages', 'Released: tell organiser', { flow: 'side', guard: 'The booking was released for not checking in.', refs: ['D-17', 'AC-J02-09'] }),
  ],
});

// ---------------------------------------------------------------------------
// Check-in for one booking
// ---------------------------------------------------------------------------
export const checkIn: MachineDef = machine({
  id: 'check-in',
  title: 'Check-in',
  kind: 'shared',
  summary: 'Opens shortly before the start; either someone checks in, or the grace period ends.',
  refs: ['D-15', 'D-16', 'PN-02', 'PN-03'],
  entries: { default: 'not-open' },
  exits: { present: 'checked-in', absent: 'missed' },
  states: [
    s('not-open', 'Not open yet', { description: 'It is too early to check in.', refs: ['D-15', 'PN-02'] }),
    s('open', 'Check-in open', {
      description: 'Check-in is offered at the room and from the booking.',
      rules: ['Open from the start of the check-in window until the end of the grace period.'],
      refs: ['D-15', 'D-16', 'PN-02', 'PN-03', 'AC-J02-08'],
      open: { questions: ['Q-03'], note: 'The length of the grace period has no value yet, so how long this state can last is not known.' },
    }),
    final('checked-in', 'Checked in', { refs: ['D-15'] }),
    final('missed', 'Not checked in', { description: 'The grace period ended with no check-in.', refs: ['D-16', 'PN-03'] }),
  ],
  transitions: [
    t('not-open', 'open', 'Window opens', { actor: 'time', flow: 'main', refs: ['D-15', 'PN-02', 'AC-J02-08'] }),
    t('open', 'checked-in', 'Check in', { actor: 'user', flow: 'main', refs: ['D-15', 'AC-J02-08'] }),
    t('open', 'missed', 'Grace period ends', { actor: 'time', flow: 'side', refs: ['D-16', 'PN-03', 'AC-J02-09'] }),
  ],
});

// ---------------------------------------------------------------------------
// The booking record
// ---------------------------------------------------------------------------
export const booking: MachineDef = machine({
  id: 'booking',
  title: 'Booking',
  kind: 'entity',
  summary: 'One room, one period, one organiser: from confirmed to over.',
  description: 'How a booking changes over time, whichever journey acts on it. A hold is not a booking and is not part of this lifecycle.',
  refs: ['D-01', 'D-02', 'D-10'],
  entries: { default: 'upcoming' },
  states: [
    s('upcoming', 'Upcoming', {
      description: 'Confirmed and not started. The room is the organiser\'s for the period.',
      rules: ['No other booking overlaps it in the same room.'],
      refs: ['D-01', 'D-02', 'D-10', 'AC-J01-12'],
    }),
    s('in-use', 'In use', { description: 'Someone checked in.', refs: ['D-15'] }),
    final('ended', 'Ended', { description: 'The period is over, or the meeting ended early.', refs: ['D-19', 'D-20'] }),
    final('cancelled', 'Cancelled', { description: 'The organiser cancelled before the start.', refs: ['D-13'] }),
    final('released', 'Released', { description: 'Nobody checked in by the end of the grace period. The room was given back for the rest of the period.', refs: ['D-16'] }),
  ],
  transitions: [
    t('upcoming', 'upcoming', 'Moved', { actor: 'user', flow: 'side', description: 'A new room or period, the same booking.', effects: ['The title and attendees are unchanged.'], refs: ['D-12', 'D-22', 'AC-J02-04'] }),
    t('upcoming', 'in-use', 'Checked in', { actor: 'user', flow: 'main', refs: ['D-15', 'AC-J02-08'] }),
    t('upcoming', 'cancelled', 'Cancelled', { actor: 'user', flow: 'side', refs: ['D-13', 'AC-J02-07'] }),
    t('upcoming', 'released', 'No check-in', { actor: 'time', flow: 'side', effects: ['The room is free for the rest of the period.', 'The organiser is told.'], refs: ['D-16', 'D-17', 'AC-J02-09'] }),
    t('in-use', 'ended', 'End time reached', { actor: 'time', flow: 'main', description: 'Nobody is prompted to leave.', refs: ['D-20', 'AC-J02-12'] }),
    t('in-use', 'ended', 'Ended early', {
      actor: 'unstated',
      flow: 'side',
      effects: ['The room is free for the time that is left.'],
      description: 'The sources say the room is freed when a meeting ends early, and do not say who or what ends it.',
      refs: ['D-19', 'AC-J02-11'],
    }),
  ],
});

export const manageMachines: MachineDef[] = [j02, meetingDay, checkIn, booking];
