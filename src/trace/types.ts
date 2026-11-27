// Typed structure of the cross-layer trace. The trace is a sidecar to the model: it points at model
// elements and at records in other layers, and never changes them. Statuses are copied from the record
// that holds them and are never computed from one another.

/**
 * A reference into one layer. Versioned forms carry their version, so a reference keeps resolving to the
 * version it names when a later one appears.
 *   spec:     'D-12', 'AC-J01-08', 'PN-01', 'AF-02', 'J01'     ids in src/model/generated/sources.json
 *   model:    'model:booking-hold' | 'model:booking-hold/held__confirming'
 *   handoff:  'handoff:room-booking/v1#IX-05'                  row or heading in that version's files
 *   design:   'design-map:room-booking/v1#IX-05'               row in design/v1/DESIGN_MAP.md
 *   figma:    'figma:<fileKey>/17-1022'                        a frame listed in a design map
 *   code:     'code:some-repo@1a2b3c4:src/x.py#L10-L20'        a line range at a commit
 *   test:     'test:some-repo@1a2b3c4:tests/x.py::name'        a test definition at a commit
 *   notion:   'notion:<32 hex characters>'                     a Notion page (not checkable offline)
 *   scenario: 'model-scenario:S02'                             a worked scenario in src/model/scenarios.ts
 *   trace:    'finding:XLF-01', 'work:WI-01'
 */
export type TraceRef = string;

/** A revision of a source, recorded when something was linked or checked. */
export interface Revision {
  id: string; // 'rev-model-baseline', 'rev-handoff-v2', ...
  source: 'model' | 'archive' | 'notion' | 'handoff' | 'design' | 'git' | 'conversation';
  /** Exact version: a commit, 'v2', 'J01 v2', 'D-01..D-22', or who said it and when for a conversation. */
  version: string;
  /** File or content hash where one exists. */
  hash?: string;
  checkedAt: string; // ISO date
  how: string; // how the revision was established
}

/** One end of a link, pinned to the revision it was recorded against. */
export interface Endpoint {
  ref: TraceRef;
  rev: string; // Revision.id
  /** For model element refs: the deterministic hash of the element definition when recorded. */
  elementHash?: string;
}

export type LinkType =
  | 'refines' //       handoff SR/IX        → model element it details
  | 'designs' //       design-map row/frame → handoff SR/IX
  | 'allocates-to' //  model element        → architecture follow-up
  | 'evidences' //     code in another repo → architecture follow-up (evidence only: not an implementation)
  | 'covers' //        scenario definition  → model element
  | 'tests'; //        test definition      → what it exercises

/** A relationship between two endpoints that both exist. Absence is recorded as a CoverageGap instead. */
export interface Link {
  id: string; // 'L-001'
  type: LinkType;
  /** How we know it holds. 'stated': the from-record says so. 'derived': a reading, with its grounds. */
  basis: 'stated' | 'derived' | 'interpretation';
  from: Endpoint;
  to: Endpoint;
  /** For basis 'derived': the source ids both ends share, which the validator checks. */
  sharedRefs?: string[];
  note?: string;
}

/**
 * A layer or relationship an anchor is expected to have, and does not. It has no target endpoint:
 * nothing is invented for what does not exist.
 *   'checked-absent': a named source was checked at a named revision and has no corresponding record.
 *   'out-of-scope':   deliberately not traced or not provided in this increment.
 * "No link recorded" is not stored: the viewer shows it for any layer with neither links nor gaps.
 */
export interface CoverageGap {
  id: string; // 'G-01'
  anchor: TraceRef;
  expected: {
    layer: Layer;
    relationship: LinkType | 'approves' | 'implements' | 'records';
    /** Narrows what kind of endpoint is missing, e.g. 'figma' when coverage rows exist but no frame does. */
    endpoint?: 'figma' | 'design-map' | 'code' | 'test';
  };
  kind: 'checked-absent' | 'out-of-scope';
  reason: string;
  /** Required for 'checked-absent'. */
  checked?: { source: string; rev: string };
}

export type Layer = 'product' | 'model' | 'handoff' | 'design' | 'architecture' | 'implementation' | 'verification' | 'research' | 'work';

export interface RecordStatus {
  kind: 'product-class' | 'product-approval' | 'design-coverage' | 'design-acceptance' | 'design-inspection' | 'follow-up';
  value: string;
  heldIn: string;
  /**
   * Exact text in the holder that states the status, and where the validator looks for it:
   * 'row' = the referenced row or section; a workspace-relative file path; 'external' = not checkable offline.
   */
  quote?: string;
  checkIn: 'row' | 'external' | string;
}

/** A record whose own status is quoted, with where that status is held. */
export interface StatusRecord {
  ref: TraceRef;
  title: string;
  /** Statuses exactly as their holder states them. Never derived. */
  statuses: RecordStatus[];
  /** Model refs this record applies to as a whole (for approvals that cover a component). */
  appliesTo?: TraceRef[];
  rev: string;
}

/** A scenario that walks through elements. model scenarios come from src/model/scenarios.ts. */
export interface ScenarioDef {
  ref: TraceRef; // 'handoff:room-booking/v1#SCN-02'
  title: string;
  rev: string;
}

/** A test definition. Its existence says nothing about whether it passes. */
export interface TestDef {
  ref: TraceRef; // 'test:<repo>@<sha>:<path>::<name>'
  title: string;
  rev: string;
  note?: string;
}

/** A completed check run. Only this establishes a result. */
export interface CheckRun {
  id: string; // 'RUN-01'
  of: TraceRef; // a TestDef or ScenarioDef ref
  /** Revisions the run was made against: code, spec, model. */
  revisions: string[];
  result: 'pass' | 'fail' | 'inconclusive';
  ranAt: string;
  by: string;
  artifact?: string;
}

export interface Finding {
  id: string; // 'XLF-01'
  title: string;
  /** Elements the finding is attached to directly. */
  targets: TraceRef[];
  /** The component the targets belong to; the finding is shown as related on the component's other elements. */
  component: TraceRef;
  kind: 'unstated' | 'missing-record' | 'contradiction' | 'interpretation-unconfirmed';
  what: string;
  consequence: string;
  scenarios: TraceRef[];
  at: string[]; // Revision ids
  status: 'open' | 'answered' | 'withdrawn';
  /** For status 'answered': the decisions that answer it. Answered is not resolved: the finding stays in the trace. */
  answeredBy?: TraceRef[];
  loggedBy: string;
  loggedAt: string;
}

/** A proposed work item. Logging, creating, assigning and starting an agent are separate actions. */
export interface WorkItem {
  id: string; // 'WI-01'
  findings: string[]; // one or several findings; a finding may also have several work items
  /** The tracker the item is meant for, by name, e.g. 'issue-tracker'. Nothing is ever sent to it from here. */
  system: string;
  state: 'draft' | 'approved-to-create' | 'created' | 'linked-existing';
  key?: string;
  dedupeKey: string;
  title: string;
  body: string;
  /** What has happened to the item since it was drafted, e.g. that its question was answered. Never sent. */
  note?: string;
}

export interface TraceData {
  version: 1;
  /** Revision of this trace; revision 1 is the original file. A later revision supersedes, and never edits, an earlier one. */
  revision?: number;
  supersedes?: { file: string; baselineCommit: string; review: string };
  /** What this trace covers, in a few words, e.g. the component it was written for. Shown in the viewer. */
  scope: string;
  status: string;
  baseline: { modelCommit: string };
  revisions: Revision[];
  records: StatusRecord[];
  links: Link[];
  gaps: CoverageGap[];
  scenarios: ScenarioDef[];
  tests: TestDef[];
  runs: CheckRun[];
  findings: Finding[];
  workItems: WorkItem[];
}
