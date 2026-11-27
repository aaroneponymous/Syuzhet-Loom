import type { ReactNode } from 'react';
import { machineList, machines, openQuestions, ROOT_MACHINE } from '../model';
import type { MachineDef, OpenMark, OpenQuestion, RefId } from '../model/types';
import sources from '../model/generated/sources.json';
import type { Resolved } from './graph';
import { ResponseBox, useResponses } from './responses';
import { ActorIcon } from './flowParts';
import { TraceSection } from './Trace';

const ACTOR_TEXT: Record<string, string> = { user: 'Done by the person', app: 'Done by the app', time: 'Caused by time passing', unstated: 'Who causes it is not stated' };

type SourceEntry = { kind: string; text: string; why?: string; from?: string; note?: string; journey?: string };
const refs = (sources as { refs: Record<string, SourceEntry> }).refs;
export const sourceRecord = (sources as unknown as { record: any }).record;
export const questionById = new Map(openQuestions.map((q) => [q.id, q]));

export const STATUS_LABEL: Record<OpenQuestion['status'], string> = {
  unresolved: 'Needs a decision',
  'open-inside-rules': 'Open, within agreed rules',
  parameter: 'Tracked as a number',
  discrepancy: 'Sources disagree',
  ambiguity: 'Ambiguous term',
  'not-applicable': 'No longer applicable',
};

const KIND_NAME: Record<MachineDef['kind'], string> = {
  overview: 'Overview',
  journey: 'Journey',
  shared: 'Shared component',
  entity: 'Record lifecycle',
  boundary: 'Journey not yet written',
};

// order in which source references are listed
const REF_ORDER: RegExp[] = [/^D-/, /^AC-/, /^PN-/, /^RP-/, /^(AF|EV)-/, /^(DF|S|P)-/];
const refRank = (id: string) => {
  const i = REF_ORDER.findIndex((re) => re.test(id));
  return i < 0 ? REF_ORDER.length : i;
};

export interface PanelProps {
  rootId: string;
  resolved: Resolved | null;
  selPath: string | null;
  questionId: string | null;
  onQuestion: (id: string | null) => void;
  onGoto: (machineId: string, elementId?: string) => void;
  onClose: () => void;
}

/** A collapsed section for detail that most readers do not need first. */
function More({ title, count, children, open }: { title: string; count?: number; children: ReactNode; open?: boolean }) {
  return (
    <details className="more" open={open}>
      <summary>
        {title}
        {count !== undefined && <span className="more-count">{count}</span>}
      </summary>
      <div className="more-body">{children}</div>
    </details>
  );
}

function QuestionChip({ id, onQuestion }: { id: RefId; onQuestion: (id: string) => void }) {
  const q = questionById.get(id);
  const { counts } = useResponses();
  if (!q) return null;
  const answered = counts.get(`q:${id}`) ?? 0;
  return (
    <button className="ref-q" onClick={() => onQuestion(id)}>
      <span className="ref-q-id">{id}</span>
      <span className="ref-q-title">{q.title}</span>
      {answered > 0 && (
        <span className="resp-dot inline" title="You have logged a response">
          answered
        </span>
      )}
    </button>
  );
}

/** Splits the archive's leading amendment notes, written "*( … )*", from the wording itself. */
function splitNotes(text: string): { notes: string[]; body: string } {
  const notes: string[] = [];
  const body = text.replace(/\*\((.*?)\)\*\s*/g, (_m, n: string) => (notes.push(n), '')).trim();
  return { notes, body };
}

function SourceItem({ id }: { id: RefId }) {
  const e = refs[id];
  if (!e)
    return (
      <li className="src-plain">
        <b>{id}</b>
      </li>
    );
  return (
    <li>
      <details>
        <summary>
          <b className="ref-id">{id}</b> <span className="ref-preview">{splitNotes(e.text).body}</span>
        </summary>
        <div className="ref-body">
          {splitNotes(e.text).notes.map((n) => (
            <p key={n} className="ref-note">
              {n}
            </p>
          ))}
          <p>{splitNotes(e.text).body}</p>
          {e.why && (
            <p className="muted">
              <i>Why:</i> {e.why}
            </p>
          )}
          {e.from && (
            <p className="muted">
              <i>From:</i> {e.from}
            </p>
          )}
          {e.note && (
            <p className="muted">
              <i>Note:</i> {e.note}
            </p>
          )}
          <p className="ref-kind">{e.kind} · original wording</p>
        </div>
      </details>
    </li>
  );
}

/** Decisions, criteria and other ids behind an element. Open points are listed first, as links. */
function Sources({ ids, onQuestion, open }: { ids?: RefId[]; onQuestion: (id: string) => void; open?: boolean }) {
  const uniq = [...new Set(ids ?? [])];
  const qs = uniq.filter((r) => questionById.has(r));
  const rest = uniq.filter((r) => !questionById.has(r)).sort((a, b) => refRank(a) - refRank(b));
  if (!uniq.length) return null;
  return (
    <>
      {qs.length > 0 && (
        <section>
          <h4>Related open points</h4>
          <div className="q-list">
            {qs.map((q) => (
              <QuestionChip key={q} id={q} onQuestion={onQuestion} />
            ))}
          </div>
        </section>
      )}
      {rest.length > 0 && (
        <More title="Sources" count={rest.length} open={open ?? rest.length <= 10}>
          <ul className="ref-list">
            {rest.map((r) => (
              <SourceItem key={r} id={r} />
            ))}
          </ul>
        </More>
      )}
    </>
  );
}

function OpenBox({ open, onQuestion }: { open?: OpenMark; onQuestion: (id: string) => void }) {
  if (!open) return null;
  return (
    <section className="box box-open" data-testid="open-box">
      <h4>
        <span className="badge-open">OPEN</span> This is not decided
      </h4>
      <p>{open.note}</p>
      <div className="q-list">
        {open.questions.map((q) => (
          <QuestionChip key={q} id={q} onQuestion={onQuestion} />
        ))}
      </div>
    </section>
  );
}

function ModelNote({ text }: { text?: string | string[] }) {
  if (!text || (Array.isArray(text) && !text.length)) return null;
  const list = Array.isArray(text) ? text : [text];
  return (
    <More title="Modelling note" count={list.length > 1 ? list.length : undefined}>
      {list.map((t, i) => (
        <p key={i}>{t}</p>
      ))}
      <p className="muted">Structure added to draw the behaviour. It is not a product decision.</p>
    </More>
  );
}

function elementsCiting(qid: string) {
  const out: { machine: MachineDef; id: string; label: string }[] = [];
  for (const m of machineList) {
    for (const s of m.states) if (s.open?.questions.includes(qid)) out.push({ machine: m, id: s.id, label: s.label });
    for (const t of m.transitions) if (t.open?.questions.includes(qid)) out.push({ machine: m, id: t.id, label: t.event });
  }
  return out;
}

function QuestionView({ q, onGoto }: { q: OpenQuestion; onGoto: PanelProps['onGoto'] }) {
  const marked = elementsCiting(q.id);
  const closed = q.status === 'not-applicable';
  return (
    <div data-testid="question-view">
      <div className="panel-kicker">
        {!closed && <span className="badge-open">OPEN</span>} {STATUS_LABEL[q.status]}
      </div>
      <h3>
        {q.id} <span className="h3-sub">{q.title}</span>
      </h3>
      <p>{q.question}</p>
      {q.options && !closed && (
        <section>
          <h4>What needs deciding</h4>
          <ul>
            {q.options.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </section>
      )}
      {closed && q.handling && <p className="muted">{q.handling}</p>}
      {!closed && (
        <ResponseBox target={{ key: `q:${q.id}`, type: 'question', label: `${q.id} ${q.title}`, context: 'Open point', link: `#/overview?q=${q.id}`, options: q.options }} />
      )}
      <section>
        <h4>Marked in the model ({marked.length})</h4>
        {marked.length === 0 && <p className="muted">Nothing on the map carries this mark.</p>}
        <ul className="link-list">
          {marked.map((e) => (
            <li key={e.machine.id + e.id}>
              <button onClick={() => onGoto(e.machine.id, e.id)}>
                <b>{e.label}</b> <span className="muted">· {e.machine.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {!closed && q.handling && (
        <More title="How the map shows it">
          <p>{q.handling}</p>
        </More>
      )}
      <Sources ids={q.decisions} onQuestion={() => {}} open={false} />
    </div>
  );
}

function openIdsOf(m: MachineDef): string[] {
  const ids = new Set<string>();
  for (const s of m.states) s.open?.questions.forEach((q) => ids.add(q));
  for (const t of m.transitions) t.open?.questions.forEach((q) => ids.add(q));
  return [...ids];
}

/** Details of a component: shown for the current view, and under a selected component. */
function MachineDetails({ m, onGoto, onQuestion, about = true }: { m: MachineDef; onGoto: PanelProps['onGoto']; onQuestion: (id: string) => void; about?: boolean }) {
  const usedBy = machineList.filter((x) => x.kind !== 'overview' && x.states.some((s) => s.uses === m.id));
  const openIds = openIdsOf(m);
  const mapped = Object.keys(m.entries ?? {}).length + Object.keys(m.exits ?? {}).length;
  const labelOf = (spec: string) => m.states.find((s) => s.id === spec.split(':')[0])?.label ?? spec;
  return (
    <>
      {openIds.length > 0 && (
        <section>
          <h4>Open points here</h4>
          <div className="q-list">
            {openIds.map((q) => (
              <QuestionChip key={q} id={q} onQuestion={onQuestion} />
            ))}
          </div>
        </section>
      )}
      {about && m.description && (
        <More title="About" open>
          <p>{m.description}</p>
        </More>
      )}
      {usedBy.length > 0 && (
        <More title="Used by" count={usedBy.length}>
          <ul className="link-list">
            {usedBy.map((u) => (
              <li key={u.id}>
                <button onClick={() => onGoto(u.id)}>{u.title}</button>
              </li>
            ))}
          </ul>
        </More>
      )}
      {mapped > 0 && (
        <More title="Ways in and out" count={mapped}>
          <ul className="io-list">
            {Object.entries(m.entries ?? {}).map(([k, v]) => (
              <li key={'e' + k}>
                <span className="io-dir">In</span> <b>{labelOf(v)}</b> <span className="io-name">{k}</span>
              </li>
            ))}
            {Object.entries(m.exits ?? {}).map(([k, v]) => (
              <li key={'x' + k}>
                <span className="io-dir io-out">Out</span> <b>{labelOf(v)}</b> <span className="io-name">{k}</span>
              </li>
            ))}
          </ul>
        </More>
      )}
      <ModelNote text={m.interpretations} />
      <Sources ids={m.refs} onQuestion={onQuestion} open={false} />
    </>
  );
}

export function Panel({ rootId, resolved, selPath, questionId, onQuestion, onGoto, onClose }: PanelProps) {
  const q = questionId ? questionById.get(questionId) : null;
  const copyLink = () => navigator.clipboard?.writeText(window.location.href).catch(() => {});
  let body: JSX.Element;

  if (q) body = <QuestionView q={q} onGoto={onGoto} />;
  else if (resolved?.state) {
    const { state, machine, trail } = resolved;
    const sub = state.uses ? machines[state.uses] : undefined;
    const kind = sub ? KIND_NAME[sub.kind] : state.kind === 'final' ? 'End state' : state.kind === 'choice' ? 'Decision point' : state.kind === 'initial' ? 'Start' : 'State';
    body = (
      <div data-testid="state-view">
        <div className="panel-kicker">{kind}</div>
        <h3>{state.label}</h3>
        {(machine.id !== ROOT_MACHINE || state.multiplicity) && (
          <p className="where">
            {machine.id !== ROOT_MACHINE && (
              <>
                in{' '}
                <button className="btn-link" onClick={() => onGoto(machine.id)}>
                  {machine.title}
                </button>
                {trail.length > 0 && <span className="muted"> · {trail.map((t) => t.label).join(' › ')}</span>}
              </>
            )}
            {state.multiplicity && <span className="chip chip-mult">× {state.multiplicity}</span>}
          </p>
        )}
        {state.description && <p>{state.description}</p>}
        {/* the component's own description, once: it is not repeated under About */}
        {sub && !state.description && <p>{sub.description ?? sub.summary}</p>}
        {sub?.kind === 'boundary' && <p className="muted">This journey is not written yet, so nothing is drawn inside it.</p>}
        <div className="action-row">
          {sub && sub.kind !== 'boundary' && (
            <button className="btn" onClick={() => onGoto(sub.id)}>
              Open {sub.title} <span aria-hidden="true">⤢</span>
            </button>
          )}
          <ResponseBox
            target={{ key: `e:${machine.id}/${state.id}`, type: sub ? 'component' : 'state', label: state.label, context: `${machine.title} · ${sub ? 'component' : 'state'}`, link: `#/${machine.id}/${state.id}` }}
          />
        </div>
        <OpenBox open={state.open} onQuestion={onQuestion} />
        {state.rules && state.rules.length > 0 && (
          <section>
            <h4>Rules</h4>
            <ul>
              {state.rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </section>
        )}
        <Sources ids={state.refs} onQuestion={onQuestion} />
        <ModelNote text={state.interpretation} />
        {sub && sub.kind !== 'boundary' && <MachineDetails m={sub} onGoto={onGoto} onQuestion={onQuestion} about={!!state.description} />}
        <TraceSection machineId={machine.id} elementId={state.id} uses={sub?.id} />
      </div>
    );
  } else if (resolved?.transition) {
    const { transition: t, machine } = resolved;
    const from = machine.states.find((s) => s.id === t.from);
    const to = machine.states.find((s) => s.id === t.to);
    body = (
      <div data-testid="transition-view">
        <div className="panel-kicker">{t.kind === 'signal' ? 'Signal' : 'Event'}</div>
        <h3>{t.event}</h3>
        <p className="from-to">
          <span>{from?.label}</span>
          <b>→</b>
          <span>{to?.label}</span>
        </p>
        <p className="where">
          in{' '}
          <button className="btn-link" onClick={() => onGoto(machine.id)}>
            {machine.title}
          </button>
          {t.fromExit && <span className="muted"> · exit: {t.fromExit}</span>}
          {to?.uses && t.toEntry && <span className="muted"> · entry: {t.toEntry}</span>}
          {from?.uses && !t.fromExit && t.kind !== 'signal' && <span className="muted"> · from any point inside “{from.label}”</span>}
        </p>
        {(t.actor || t.flow) && (
          <p className="facts">
            {t.actor && (
              <span className="fact">
                <ActorIcon actor={t.actor} /> {ACTOR_TEXT[t.actor]}
              </span>
            )}
            {t.flow && <span className="fact">{t.flow === 'main' ? 'Main path' : 'Side path'}</span>}
          </p>
        )}
        {t.description && <p>{t.description}</p>}
        <div className="action-row">
          <ResponseBox
            target={{ key: `e:${machine.id}/${t.id}`, type: 'transition', label: `${t.event} (${from?.label ?? t.from} → ${to?.label ?? t.to})`, context: `${machine.title} · ${t.kind === 'signal' ? 'signal' : 'event'}`, link: `#/${machine.id}/${t.id}` }}
          />
        </div>
        <OpenBox open={t.open} onQuestion={onQuestion} />
        {t.guard && (
          <section>
            <h4>Only when</h4>
            <p>{t.guard}</p>
          </section>
        )}
        {t.effects && t.effects.length > 0 && (
          <section>
            <h4>What happens</h4>
            <ul>
              {t.effects.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </section>
        )}
        <Sources ids={t.refs} onQuestion={onQuestion} />
        <ModelNote text={t.interpretation} />
        <TraceSection machineId={machine.id} elementId={t.id} />
      </div>
    );
  } else {
    const m = machines[rootId];
    body = (
      <div data-testid="machine-view">
        {m.kind !== 'overview' && (
          <div className="panel-kicker">
            {KIND_NAME[m.kind]}
            {m.parallel ? ' · parts run side by side' : ''}
          </div>
        )}
        <h3>{m.kind === 'overview' ? KIND_NAME.overview : m.title}</h3>
        <p>{m.summary}</p>
        <div className="action-row">
          <ResponseBox target={{ key: `m:${m.id}`, type: 'component', label: m.title, context: 'Whole component', link: `#/${m.id}` }} />
        </div>
        {m.kind === 'overview' && (
          <ul className="hints">
            <li>
              <kbd>▸</kbd> opens a component in place; <kbd>⤢</kbd> gives it the whole canvas.
            </li>
            <li>Click any box or arrow to read its rules and sources here.</li>
            <li>
              <span className="badge-open">OPEN</span> marks what is not decided. You can answer it here.
            </li>
          </ul>
        )}
        {m.kind === 'boundary' && <p className="muted">This journey is not written yet, so nothing is drawn inside it.</p>}
        <MachineDetails m={m} onGoto={onGoto} onQuestion={onQuestion} />
        {m.kind !== 'overview' && <TraceSection machineId={m.id} />}
      </div>
    );
  }

  const hasSel = !!(q || selPath);
  return (
    <aside className="panel" data-testid="panel">
      {hasSel && (
        <div className="panel-actions">
          <button className="btn-quiet" onClick={copyLink} title="Copy a direct link to this">
            Copy link
          </button>
          <button className="btn-quiet" onClick={onClose} title="Close and show the whole view" aria-label="Close">
            ✕
          </button>
        </div>
      )}
      {body}
    </aside>
  );
}
