import { machine, s, signal } from '../dsl';
import type { MachineDef } from '../types';

// ---------------------------------------------------------------------------
// A journey that is not written yet. A labelled boundary only: no invented internals.
// ---------------------------------------------------------------------------
export const recurring: MachineDef = machine({
  id: 'j06',
  title: 'J06 Recurring bookings',
  kind: 'boundary',
  summary: 'Book the same room every week.',
  description: 'This journey is not written yet (DF-01). It appears only as a boundary so that a connection to it has somewhere to point. Its internals are deliberately not modelled.',
  refs: ['DF-01'],
  states: [],
  transitions: [],
});

// ---------------------------------------------------------------------------
// The overview map
// ---------------------------------------------------------------------------
const J = 'Journeys';
const SH = 'Shared components';
const EN = 'Record lifecycles';
const OT = 'Other journeys (not modelled)';

export const overview: MachineDef = machine({
  id: 'overview',
  title: 'Meeting-room booking',
  kind: 'overview',
  summary: 'From needing a room to an empty room again: journeys J01 and J02, the components they share, and the booking record.',
  description:
    'The overview. Journeys are flows a person goes through. Shared components are defined once and used by more than one journey. A record lifecycle describes how one kind of record changes over time, whichever journey acts on it. Every booking stands alone: bookings that repeat are deferred (DF-01) and are not drawn.',
  parallel: true,
  refs: ['D-01', 'D-02', 'D-03', 'DF-01'],
  states: [
    s('j01', 'J01 Book a room', { uses: 'j01', lane: J }),
    s('j02', 'J02 Manage a booking', { uses: 'j02', lane: J }),

    s('room-search', 'Room search', { uses: 'room-search', lane: SH }),
    s('booking-hold', 'Booking hold', { uses: 'booking-hold', lane: SH }),
    s('meeting-day', 'On the day', { uses: 'meeting-day', lane: SH }),
    s('check-in', 'Check-in', { uses: 'check-in', lane: SH }),

    s('booking', 'Booking', { uses: 'booking', lane: EN }),

    s('j06', 'J06 Recurring bookings', { uses: 'j06', lane: OT }),
  ],
  transitions: [
    signal('j01', 'room-search', 'finds a room with', { refs: ['D-04'] }),
    signal('j01', 'booking-hold', 'reserves through', { description: 'A room is held first and booked on confirmation.', refs: ['D-06', 'D-10'] }),
    signal('j02', 'room-search', 'finds a new slot with', { description: 'Moving a booking is the same search, filled in with the booking\'s current values.', refs: ['D-12'] }),
    signal('j02', 'booking-hold', 'moves through', { description: 'The new room and period are held and confirmed exactly as a new booking would be.', refs: ['D-12'] }),
    signal('booking-hold', 'booking', 'creates or moves', { refs: ['D-10', 'D-22'] }),
    signal('j02', 'booking', 'cancels', { refs: ['D-13'] }),
    signal('j02', 'meeting-day', 'on the day', { refs: ['D-15', 'D-18'] }),
    signal('meeting-day', 'check-in', 'runs', { refs: ['D-15'] }),
    signal('meeting-day', 'booking', 'starts, releases, ends', { refs: ['D-16', 'D-19', 'D-20'] }),
    signal('booking', 'j06', 'one of a series (deferred)', {
      description: 'When recurring bookings are written, each occurrence will be a booking. Nothing about a series is modelled.',
      refs: ['DF-01'],
    }),
  ],
});

export const overviewMachines: MachineDef[] = [overview, recurring];
