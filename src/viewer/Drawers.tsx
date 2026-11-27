import { modelMeta, openQuestions } from '../model';
import type { OpenQuestion } from '../model/types';
import { STATUS_LABEL, sourceRecord } from './Panel';
import { useResponses } from './responses';
import { ActorIcon } from './flowParts';

const GROUPS: { status: OpenQuestion['status'][]; title: string; hint: string }[] = [
  { status: ['unresolved'], title: 'Needs a decision', hint: 'These change how the product behaves.' },
  { status: ['discrepancy', 'ambiguity'], title: 'Sources disagree or are unclear', hint: 'Found while drawing the map.' },
  { status: ['open-inside-rules'], title: 'Open, within agreed rules', hint: 'Content, placement or evidence. They can wait.' },
  { status: ['parameter'], title: 'Tracked as numbers', hint: 'Limits and periods with no value yet.' },
  { status: ['not-applicable'], title: 'No longer applicable', hint: 'Closed without an answer.' },
];

/** Every open point in one list, grouped by how much it matters. */
export function OpenPointsDrawer({ onClose, onPick }: { onClose: () => void; onPick: (id: string) => void }) {
  const { counts } = useResponses();
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="open-points-drawer">
        <div className="modal-head">
          <h3>Open points</h3>
          <button className="btn-quiet" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="muted">Nothing here is decided by the model. Pick one to read it and log your answer.</p>
        {GROUPS.map((g) => {
          const qs = openQuestions.filter((q) => g.status.includes(q.status));
          if (!qs.length) return null;
          return (
            <section key={g.title} className="op-group">
              <h4>
                {g.title} <span className="more-count">{qs.length}</span>
              </h4>
              <p className="muted">{g.hint}</p>
              <div className="q-list">
                {qs.map((q) => {
                  const n = counts.get(`q:${q.id}`) ?? 0;
                  return (
                    <button
                      key={q.id}
                      className={`ref-q ${q.status === 'unresolved' || q.status === 'discrepancy' || q.status === 'ambiguity' ? '' : 'is-quiet'}`}
                      onClick={() => {
                        onPick(q.id);
                        onClose();
                      }}
                    >
                      <span className="ref-q-id">{q.id}</span>
                      <span className="ref-q-title">{q.title}</span>
                      {n > 0 && <span className="resp-dot inline">answered</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** How to read the map, and which source versions it represents. */
export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="help-modal">
        <div className="modal-head">
          <h3>About this map</h3>
          <button className="btn-quiet" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p>
          <b>{modelMeta.title}.</b> {modelMeta.description} It draws what the source documents say; it does not decide anything.
        </p>
        <p className="muted">“Main path” and “who causes it” are the modeller’s reading of the documents, added to make the map easier to follow. They are not product decisions.</p>

        <h4>Reading the map</h4>
        <ul className="legend">
          <li>
            <span className="lg lg-state" /> <b>State</b>: a condition that holds
          </li>
          <li>
            <span className="lg lg-final" /> <b>End state</b>
          </li>
          <li>
            <span className="lg lg-comp" /> <b>Component</b>: has its own states inside
          </li>
          <li>
            <span className="lg lg-line" /> <b>Event</b>: moves from one state to another
          </li>
          <li>
            <span className="lg lg-main" /> <b>Main path</b>: the ordinary flow. Other paths (failure, retry, going back, expiry, recovery) are fainter until you choose “All paths”
          </li>
          <li>
            <span className="actor-legend">
              <ActorIcon actor="user" /> <ActorIcon actor="app" /> <ActorIcon actor="time" /> <ActorIcon actor="unstated" />
            </span>
            Who causes an event: the person, the app, time passing, or not stated
          </li>
          <li>
            <span className="lg lg-signal" /> <b>Signal</b>: one part informs another that runs alongside
          </li>
          <li>
            <span className="lg lg-open" /> <span className="badge-open">OPEN</span> Not decided. Dashed lines show the undecided paths
          </li>
          <li>
            <span className="open-count">3</span> Undecided points inside a component
          </li>
          <li>
            <span className="resp-dot">1</span> You have logged a response here
          </li>
        </ul>

        <h4>Getting around</h4>
        <table className="map-table">
          <tbody>
            <tr>
              <td>
                <b>▸ / ▾</b>
              </td>
              <td>Open or close a component in place</td>
            </tr>
            <tr>
              <td>
                <b>⤢</b>
              </td>
              <td>Give a component the whole canvas (or double-click it). The trail at the top leads back</td>
            </tr>
            <tr>
              <td>Click</td>
              <td>A box or an arrow shows its rules, conditions, effects and sources on the right</td>
            </tr>
            <tr>
              <td>Select</td>
              <td>Selecting a box or arrow fades everything not connected to it. Click empty canvas to clear</td>
            </tr>
            <tr>
              <td>Drag, scroll</td>
              <td>Pan and zoom. “Fit” shows everything again</td>
            </tr>
            <tr>
              <td>
                <b>/</b>
              </td>
              <td>Search by words or ids such as {modelMeta.exampleIds.join(', ')}</td>
            </tr>
            <tr>
              <td>Respond</td>
              <td>Answer an open point or comment on anything. It is logged for review; it is not a decision until recorded</td>
            </tr>
          </tbody>
        </table>

        <details className="more">
          <summary>Source versions</summary>
          <div className="more-body">
            <p>
              {modelMeta.sourceNote} Wording shown under “Sources” is the wording extracted from <code>{sourceRecord.archive.folder}</code>.
            </p>
            <table className="map-table">
              <thead>
                <tr>
                  <th>Source file</th>
                  <th>SHA-256 (first 12)</th>
                  <th>Bytes</th>
                </tr>
              </thead>
              <tbody>
                {sourceRecord.archive.files.map((f: any) => (
                  <tr key={f.file}>
                    <td>{f.file}</td>
                    <td>
                      <code>{f.sha256.slice(0, 12)}</code>
                    </td>
                    <td>{f.bytes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted">Extracted {sourceRecord.extractedAt.slice(0, 10)}. Full record in SOURCE_VERSIONS.md; coverage in COVERAGE.md.</p>
          </div>
        </details>
        <p className="muted" data-testid="help-product">
          Drawn with Syuzhet Loom. <i>From Intent to Implementation.</i>
        </p>
      </div>
    </div>
  );
}

export { STATUS_LABEL };
