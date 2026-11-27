import { machines, scenarios } from '../model';

/** Pick a worked example to walk through. */
export function ScenarioList({ onClose, onPick }: { onClose: () => void; onPick: (id: string) => void }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="scenario-list">
        <div className="modal-head">
          <h3>Scenarios</h3>
          <button className="btn-quiet" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="muted">Worked examples, played on the map one step at a time. They show paths the documents describe; they are not tests.</p>
        <div className="sc-list">
          {scenarios.map((s) => (
            <button key={s.id} className="sc-item" onClick={() => onPick(s.id)}>
              <span className="sc-title">{s.title}</span>
              <span className="sc-summary">{s.summary}</span>
              <span className="sc-meta">
                {s.steps.length} steps · {s.source}
                {s.outcome === 'gap' && <span className="badge-open">ENDS AT A GAP</span>}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The bar that steps through a scenario; each step selects one state or event on the map. */
export function ScenarioPlayer({
  play,
  onStep,
  onQuestion,
  onClose,
}: {
  play: { id: string; step: number };
  onStep: (step: number) => void;
  onQuestion: (id: string) => void;
  onClose: () => void;
}) {
  const sc = scenarios.find((s) => s.id === play.id);
  if (!sc) return null;
  const step = sc.steps[play.step];
  const last = play.step === sc.steps.length - 1;
  return (
    <div className="sc-player" data-testid="scenario-player">
      <div className="sc-player-head">
        <span className="sc-player-title">{sc.title}</span>
        <span className="sc-count">
          Step {play.step + 1} of {sc.steps.length}
        </span>
        <button className="btn-quiet" onClick={onClose} aria-label="Stop the scenario">
          ✕
        </button>
      </div>
      <div className="sc-progress">
        {sc.steps.map((_, i) => (
          <button key={i} className={i === play.step ? 'on' : i < play.step ? 'done' : ''} onClick={() => onStep(i)} aria-label={`Go to step ${i + 1}`} />
        ))}
      </div>
      <p className="sc-note">
        <span className="sc-where">{machines[step.machine]?.title}</span> {step.note}
      </p>
      {last && sc.outcome === 'gap' && (
        <p className="sc-gap">
          <span className="badge-open">OPEN</span> The documents do not decide what happens next.{' '}
          {(sc.questions ?? []).map((q) => (
            <button key={q} className="btn-link" onClick={() => onQuestion(q)}>
              {q}
            </button>
          ))}
        </p>
      )}
      <div className="sc-controls">
        <button className="btn-quiet" disabled={play.step === 0} onClick={() => onStep(play.step - 1)}>
          ← Previous
        </button>
        <button className="btn" data-testid="scenario-next" disabled={last} onClick={() => onStep(play.step + 1)}>
          Next →
        </button>
      </div>
    </div>
  );
}
