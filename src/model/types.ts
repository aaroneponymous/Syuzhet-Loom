// Typed structure of the model. Rendering code never hard-codes behaviour:
// everything shown comes from machines built with these types.

/** A stable id from the source documents: D-12, AC-J01-08, Q-02, C-1, PN-01, RP-01, AF-02, EV-05, DF-01, S-24. */
export type RefId = string;

export type MachineKind =
  | 'overview' // the overview map
  | 'journey' // a user journey flow (J01, J02, ...)
  | 'shared' // a component defined once and referenced by several journeys
  | 'entity' // the lifecycle of one kind of record (a booking, an order, ...)
  | 'boundary'; // a journey that is not written yet: a labelled box with no internals

/** Marks behaviour the specification has not settled. An annotation, not a runtime state. */
export interface OpenMark {
  /** Open-question ids, e.g. ['Q-02'] or ['C-1']. Must exist in openQuestions. */
  questions: RefId[];
  /** What exactly is uncertain here, in one or two sentences. */
  note: string;
}

export type Actor = 'user' | 'app' | 'time' | 'unstated';
export type Flow = 'main' | 'side';

export type StateKind = 'state' | 'initial' | 'final' | 'choice';

export interface StateDef {
  /** Unique within its machine. kebab-case. */
  id: string;
  /** Short visible label (aim for three words or fewer). A condition, not an event. */
  label: string;
  kind?: StateKind;
  /** One or two sentences for the details panel. */
  description?: string;
  /** Rules and conditions that hold while in this state. */
  rules?: string[];
  refs?: RefId[];
  /** This state is a composite: an instance of another machine (by machine id). */
  uses?: string;
  /** For composites that exist many times at once, e.g. "one per attendee". Expresses concurrency. */
  multiplicity?: string;
  /** Lane title, used to group regions of a parallel machine into columns. */
  lane?: string;
  open?: OpenMark;
  /** Set when this element is the modeller's interpretation, not a confirmed product decision. */
  interpretation?: string;
}

export interface TransitionDef {
  /** Unique within its machine. Assigned by machine() when omitted. */
  id: string;
  from: string;
  to: string;
  /** Short visible label naming the event. */
  event: string;
  /**
   * 'transition' (default): a state change within one machine.
   * 'signal': something in one concurrent region or component triggers or informs another.
   */
  kind?: 'transition' | 'signal';
  /** When `from` is a composite: the named exit of the used machine this leaves from. Omitted = from any inner state. */
  fromExit?: string;
  /** When `to` is a composite: the named entry of the used machine this arrives at. Omitted = 'default'. */
  toEntry?: string;
  /**
   * Who or what causes the event.
   * 'user': something the person does. 'app': an automatic outcome or step by the system.
   * 'time': a period passing (expiry, a recovery period ending).
   * 'unstated': the sources do not say who or what causes it.
   * Required on transitions; optional on signals.
   */
  actor?: Actor;
  /**
   * 'main': part of the ordinary flow when things go as intended, including the normal choices a person makes.
   * 'side': everything else: failure, retry, cancelling, going back, undo, expiry, recovery, late results,
   *         mismatches, corrections after the fact, and less common alternatives such as an empty result.
   * This is a reading aid chosen by the modeller, not a product decision. Required on every transition and signal
   * outside the overview map.
   */
  flow?: Flow;
  /** Condition that must hold for the transition to be taken. */
  guard?: string;
  /** What changes as a result. */
  effects?: string[];
  description?: string;
  refs?: RefId[];
  open?: OpenMark;
  interpretation?: string;
}

export interface MachineDef {
  id: string;
  title: string;
  kind: MachineKind;
  /** One sentence shown on the collapsed card. */
  summary: string;
  description?: string;
  refs?: RefId[];
  /**
   * true: the states are concurrent regions, all active at once (independent dimensions or
   * parallel activities). Transitions between regions must be kind 'signal'.
   */
  parallel?: boolean;
  states: StateDef[];
  transitions: TransitionDef[];
  /**
   * Named entry points for when this machine is used as a composite: name -> state id.
   * A value may be 'stateId:entryName' to delegate into a nested composite.
   * Non-parallel machines used as composites must define 'default'.
   */
  entries?: Record<string, string>;
  /** Named exit points: name -> state id (or 'stateId:exitName' to delegate). */
  exits?: Record<string, string>;
  /** Modelling interpretations that apply to the machine as a whole. */
  interpretations?: string[];
}

export type QuestionStatus =
  | 'unresolved' // changes behaviour; needs a decision
  | 'open-inside-rules' // open, but agreed rules already bound it
  | 'parameter' // tracked as a policy number
  | 'discrepancy' // the sources disagree with each other
  | 'ambiguity' // a term is used without saying which meaning applies
  | 'not-applicable'; // closed without an answer because a later decision removed the situation it asks about

export interface OpenQuestion {
  id: RefId;
  title: string;
  status: QuestionStatus;
  question: string;
  options?: string[];
  decisions?: RefId[];
  journeys?: string[];
  /** How the map currently draws it. */
  handling?: string;
}

/** A criterion that is deliberately not drawn as a state or transition. */
export interface NonVisualRule {
  id: RefId;
  reason: string;
}
