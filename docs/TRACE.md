# The trace

The model says what the product does. Other layers say other things about the same behaviour: a handoff details it for design, a design map says which rows were drawn, a follow-up says what it requires of the architecture, a test exercises some code. The trace records how those relate to model elements, and at which revision of each.

The trace is a **sidecar**. It lives in `trace/` (data) and `src/trace/` (types, hashing, queries). It points at model elements and at records in other layers and changes none of them. Each layer keeps its own form: a design row stays a design-map row, a follow-up stays an `AF-` id, a test stays a test definition at a commit. Nothing is drawn as a state machine unless it is one.

Types: `src/trace/types.ts`. Example data: `trace/example.json`, for the Booking hold component of the example model.

## 1. References, pinned

Every reference names the version it was recorded against, so it keeps meaning the same thing when a later version appears.

| Form | Example | Pinned by |
|---|---|---|
| spec id | `D-12`, `AC-J01-08`, `AF-02`, `J01` | the id (wording in `sources.json`; a file hash in the revision) |
| model | `model:booking-hold/held__confirming` | the baseline commit, plus an element hash on the endpoint |
| handoff | `handoff:room-booking/v1#IX-05` | **the version in the reference** |
| design-map | `design-map:room-booking/v1#IX-05` | the version in the reference |
| figma | `figma:<fileKey>/17-1022` | the design-map revision that lists the frame (Figma itself is never read) |
| code | `code:<repo>@<sha>:src/x.py#L10-L20` | the commit in the reference |
| test | `test:<repo>@<sha>:tests/x.py::name` | the commit in the reference |
| notion | `notion:<32 hex>` | the revision's `checkedAt` (not checkable offline) |
| scenario | `model-scenario:S02` | the baseline commit |
| trace | `finding:XLF-01`, `work:WI-01` | the trace itself |

A `v1` reference resolves only against `v1/`, whatever later versions exist. In the example, handoff `v2` exists beside `v1` and changes two rows; every reference in the trace still resolves to `v1`. Whether it still holds for `v2` is a staleness question (section 8).

`figma:` and `notion:` exist for teams whose designs and specifications live in those services. The example uses neither. Nothing in this repository ever contacts them: such references are counted as "external, not checked offline".

### Handoff folders

The handoff and design forms read this layout inside the workspace (`loom.config.ts` names the folders):

```
<handoffs>/<slice>/vN/HANDOFF.md        a table row "| **Version** | vN |"
<handoffs>/<slice>/vN/WORKFLOWS.md      scenarios:    | SCN-nn | … |
<handoffs>/<slice>/vN/SCREEN_SPEC.md    requirements: | SR-nn | … |  and  | IX-nn | … |
<handoffs>/<slice>/vN/CHANGES.md        from v2 on: one row per changed id
<handoffs>/<slice>/design/vN/DESIGN_MAP.md   a line "Handoff used: `<handoffs>/<slice>/vN/`"; one row per id
<handoffs>/<slice>/design/vN/FINDINGS.md
```

An item is a table row that starts with its id (`| IX-05 |`), or a section headed by it (`### IX-05 …`). The id prefixes are free (`[A-Z]+-\d+`); `SCN-` is read as a scenario. A version folder is not edited once it has been handed over: a change makes a new version.

## 2. Revisions and element hashes

- A `Revision` names a source and an exact version: a commit, `v1`, `J01 version 2`. Where one exists it also records a file SHA-256, and when and how the revision was established.
- Every link endpoint names its revision. Model endpoints also carry `elementHash`: the SHA-256 of the canonical JSON of that one state, transition or machine header, computed by `src/trace/hash.ts`. The same code runs in the browser and in Node.
- `baseline.modelCommit` is a commit of this repository. `validate:trace` loads `src/model` from that commit and checks model references and recorded hashes **against it**, never against the working tree. The baseline is a revision marker. It approves nothing.
- **Limit of an element hash.** It covers the element's own definition only. An unchanged hash does **not** show that the decisions it cites are unchanged, that its machine's rules are unchanged, that its parent composite, entries and exits are unchanged, or that anything it depends on is unchanged. The viewer says so next to every hash, and the staleness report compares some of those dependencies separately.

## 3. Links: real endpoints only

`Link { type, basis, from: Endpoint, to: Endpoint, sharedRefs?, note? }`. Both ends must exist.

| Type | From → to | What the validator checks |
|---|---|---|
| `refines` | handoff row → model element | `stated`: the row names the element |
| `designs` | design-map row or frame → handoff row | `stated`: same id and version; for a frame, its row carries the id (ranges like "IX-36 to IX-38" count) |
| `allocates-to` | model element → follow-up (`AF-`) | `derived`: every id in `sharedRefs` is cited by the element and by the follow-up |
| `evidences` | code in another repository → follow-up | the lines exist at the commit. Evidence only: it never means "implements" |
| `covers` | scenario definition → model element | `stated`: the scenario names the element |
| `tests` | test definition → what it exercises | the test exists at the commit |

`basis` is `stated` (the from-record says so), `derived` (a reading with checkable grounds) or `interpretation` (a reading, with a note saying what was read). There is no `missing` basis: an absence is a coverage gap.

## 4. Coverage gaps: absence without an invented endpoint

`CoverageGap { anchor, expected: { layer, relationship, endpoint? }, kind, reason, checked? }`. It has no target and no revision of a missing thing; the validator rejects either.

| What the viewer shows | Stored as | Meaning |
|---|---|---|
| **No link recorded** | nothing (shown when a layer has neither links nor gaps) | Nobody has traced it. Says nothing about whether a record exists |
| **Checked: none found** | `kind: 'checked-absent'` + `checked: { source, rev }` | A named source was checked at a named revision and has no corresponding record |
| **Outside this increment** | `kind: 'out-of-scope'` | Deliberately not traced or not provided now |

A checked absence must not contradict the data. The validator rejects a `checked-absent` gap when a recorded link of that relationship touches the anchor, or, for `covers`, when a model scenario steps through the anchor. `endpoint` narrows the claim: "IX-07 has no **design-map row**" is a narrower statement than "IX-07 has no design".

## 5. Statuses: quoted, held elsewhere, never computed

`StatusRecord { ref, statuses: [{ kind, value, heldIn, quote, checkIn }] }`.

- The kinds are `product-approval`, `product-class`, `design-coverage`, `design-inspection`, `design-acceptance` and `follow-up`.
- `checkIn` says where the validator looks for the quote: `'row'` (the referenced row or section), a workspace-relative file, or `'external'` (held in a service that is not read; shown with the date it was checked).
- The validator checks that each locally held quote still appears there. If someone changes "confirmed" to something else in the pinned `SCREEN_SPEC.md`, validation fails until the trace is corrected.
- No status is inferred from another. Implementation, verification and release have no status field at all: they appear only as links, gaps or runs.

## 6. Verification: definitions apart from runs

| Record | What it says | Shown as |
|---|---|---|
| Scenario definition (model scenarios `S..` from `src/model/scenarios.ts`; handoff `SCN-..` listed in the trace) | A path that `covers` elements | "covers", never "passes" |
| Test definition (`test:` at a commit) | A test exists that `tests` something | "tests", with what it exercises |
| Check run `{ of, revisions[], result, ranAt, by }` | A completed run against named revisions | The only place a pass or fail appears |

The example has **no runs**, because none was made. The viewer then says that no check run is recorded, so no result is shown: a definition existing is not a result.

## 7. Findings and work items

- `Finding { id: XLF-nn, targets[], component, kind, what, consequence, scenarios[], at[], status }`. Targets can be model elements or handoff rows. `component` is the whole machine.
- The viewer separates **findings on this selection** (the selection is a target) from **findings related through the component** (the selection is another element of the same machine, or a composite elsewhere that stands for it).
- A finding's status is `open`, `answered` (naming the decisions in `answeredBy`) or `withdrawn`. Answered is not resolved: the finding stays in the trace.
- `WorkItem { findings[], system, state, key?, dedupeKey, title, body }` is a **draft** of an issue for a tracker named in `system`. The relation is many-to-many. `draft` and `approved-to-create` items have no key; `created` and `linked-existing` items require one. Dedupe keys are unique. The viewer can copy the text; nothing is ever sent anywhere.

## 8. Staleness

`npm run trace-staleness` compares what the trace pinned with what is there now, and writes `trace-reports/STALENESS.md` and `staleness.json`. It reads local files and commits only and changes nothing.

For each reference it reports two separate things:

- **Pinned integrity**: does the pinned reference still resolve, and does it still match what was recorded? A handoff or design item is compared through the file hash in its revision (identical file, identical item; a different file means the effect on the item is unknown, and the report says so). A model element is compared by element hash with the model at the baseline commit. Code and tests are content-addressed by commit.
- **Later versions**: does a later version exist, and is the item unchanged, changed, removed or impossible to match there? For a handoff row the comparison is cell by cell, a later `CHANGES.md` row naming the id is quoted, and a version folder that is an incomplete draft (a required file missing, an empty file, a header naming another version) makes what it shows provisional.

For model elements it also compares **dependencies the element hash does not cover**: the machine's header, a transition's end states, the composite that stands for the component, cited open questions, and the extracted wording of cited ids. It lists what it did not check.

Everything a changed reference touches (links, findings, work items, gaps, status records) is listed as **needs review**, with the path that led there. That is a prompt to look, never a statement that a relationship is wrong; nothing is updated, migrated or resolved. If a file changes while the scan is reading, the scan is retried and, failing that, the report is marked unstable.

The report is generated output and is not committed. The viewer bundles it at build time when it is present, shows per-element staleness from it, says when it is missing, and says when it is out of date (the trace, the model or the baseline changed after it was made).

In the example, the trace pins handoff `v1`, and `v2` changes `SR-03` and `IX-06`: the report flags the links and status records that rest on those two rows.

**A trace is never refreshed wholesale.** A new trace revision follows an item-by-item review of what the report flags.

## 9. What the trace does not do

- It does not approve, implement or verify anything, and it computes no status.
- It does not read Notion, Figma or any other service, and it sends nothing to an issue tracker.
- It does not decide open questions or change the model.
