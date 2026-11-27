// Responses the reader types into the viewer: answers to open points, corrections, questions, notes.
// With `npm run dev` or `npm run preview` they are written to responses/responses.json on this
// machine. On a plain static server there is no file to write to, so they stay in this browser
// and can be downloaded.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type ResponseKind = 'answer' | 'decision' | 'correction' | 'question' | 'note';
export interface ResponseEntry {
  id: string;
  targetKey: string; // q:Q-02 | e:<machine>/<element> | m:<machine>
  targetType: 'question' | 'state' | 'transition' | 'component';
  targetLabel: string;
  context: string;
  link: string;
  kind: ResponseKind;
  choice?: string;
  text: string;
  author?: string;
  createdAt: string;
  updatedAt: string;
  reviewed?: boolean;
  reply?: string;
}
export interface ResponseTarget {
  key: string;
  type: ResponseEntry['targetType'];
  label: string;
  context: string;
  link: string;
  options?: string[];
}

type Mode = 'loading' | 'file' | 'browser';
interface Store {
  mode: Mode;
  entries: ResponseEntry[];
  author: string;
  setAuthor: (a: string) => void;
  save: (e: Omit<ResponseEntry, 'createdAt' | 'updatedAt' | 'reviewed' | 'reply'>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  counts: Map<string, number>;
  error: string | null;
}
const Ctx = createContext<Store | null>(null);
export const useResponses = () => useContext(Ctx)!;

const LS = 'syuzhet-loom-responses';
const LS_AUTHOR = 'syuzhet-loom-author';
const lsRead = (): ResponseEntry[] => {
  try {
    return JSON.parse(localStorage.getItem(LS) ?? '[]');
  } catch {
    return [];
  }
};
const lsWrite = (e: ResponseEntry[]) => {
  try {
    localStorage.setItem(LS, JSON.stringify(e));
  } catch {
    /* storage unavailable */
  }
};
const URL_ = './__responses';

export function ResponsesProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>('loading');
  const [entries, setEntries] = useState<ResponseEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [author, setAuthorState] = useState(() => {
    try {
      return localStorage.getItem(LS_AUTHOR) ?? '';
    } catch {
      return '';
    }
  });
  const setAuthor = useCallback((a: string) => {
    setAuthorState(a);
    try {
      localStorage.setItem(LS_AUTHOR, a);
    } catch {
      /* ignore */
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await fetch(URL_, { cache: 'no-store' });
      const type = r.headers.get('content-type') ?? '';
      if (!r.ok || !type.includes('json')) throw new Error('no log endpoint');
      const d = await r.json();
      setEntries(d.responses ?? []);
      setMode('file');
    } catch {
      setEntries(lsRead());
      setMode('browser');
    }
  }, []);
  useEffect(() => {
    load();
    // pick up reviewer replies written to the file while the viewer is open
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const save = useCallback<Store['save']>(
    async (e) => {
      setError(null);
      if (mode === 'file') {
        const r = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(e) });
        if (!r.ok) {
          setError('Could not write to responses/responses.json. Your text is still in the box.');
          throw new Error('save failed');
        }
        setEntries((await r.json()).responses);
        return;
      }
      const now = new Date().toISOString();
      setEntries((prev) => {
        const old = prev.find((x) => x.id === e.id);
        const entry: ResponseEntry = { ...e, createdAt: old?.createdAt ?? now, updatedAt: now, reviewed: false, reply: old?.reply };
        const next = old ? prev.map((x) => (x.id === e.id ? entry : x)) : [...prev, entry];
        lsWrite(next);
        return next;
      });
    },
    [mode],
  );
  const remove = useCallback(
    async (id: string) => {
      setError(null);
      if (mode === 'file') {
        const r = await fetch(`${URL_}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (r.ok) setEntries((await r.json()).responses);
        else setError('Could not update responses/responses.json.');
        return;
      }
      setEntries((prev) => {
        const next = prev.filter((x) => x.id !== id);
        lsWrite(next);
        return next;
      });
    },
    [mode],
  );
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) m.set(e.targetKey, (m.get(e.targetKey) ?? 0) + 1);
    return m;
  }, [entries]);

  const value = useMemo(() => ({ mode, entries, author, setAuthor, save, remove, counts, error }), [mode, entries, author, setAuthor, save, remove, counts, error]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const KIND_LABEL: Record<ResponseKind, string> = { answer: 'Answer', decision: 'Decision', correction: 'Correction', question: 'Question', note: 'Note' };
const fmt = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const newId = () => `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function Item({ e, onEdit }: { e: ResponseEntry; onEdit: () => void }) {
  const { remove } = useResponses();
  return (
    <div className={`resp-item ${e.reviewed ? 'is-reviewed' : ''}`} data-testid="response-item">
      <div className="resp-meta">
        <span className={`resp-kind k-${e.kind}`}>{KIND_LABEL[e.kind]}</span>
        {e.author && <span>{e.author}</span>}
        <span>{fmt(e.updatedAt)}</span>
        <span className={e.reviewed ? 'resp-state done' : 'resp-state'}>{e.reviewed ? 'Reviewed' : 'Awaiting review'}</span>
      </div>
      {e.choice && (
        <p className="resp-choice">
          <b>Chosen:</b> {e.choice}
        </p>
      )}
      {e.text && <p className="resp-text">{e.text}</p>}
      {e.reply && (
        <p className="resp-reply">
          <b>Reviewer reply:</b> {e.reply}
        </p>
      )}
      <div className="resp-actions">
        <button className="btn-link" onClick={onEdit}>
          Edit
        </button>
        <button className="btn-link" onClick={() => window.confirm('Delete this response?') && remove(e.id)}>
          Delete
        </button>
      </div>
    </div>
  );
}

/** The response area shown in the details panel for an open point, a state, a transition or a component. */
export function ResponseBox({ target }: { target: ResponseTarget }) {
  const { entries, save, author, setAuthor, mode, error } = useResponses();
  const mine = entries.filter((e) => e.targetKey === target.key);
  const isQuestion = target.type === 'question';
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ResponseKind>(isQuestion ? 'answer' : 'note');
  const [choice, setChoice] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  // a different target starts with a clean form
  useEffect(() => {
    setEditing(null);
    setOpen(false);
    setKind(isQuestion ? 'answer' : 'note');
    setChoice('');
    setText('');
  }, [target.key, isQuestion]);

  const startEdit = (e: ResponseEntry) => {
    setEditing(e.id);
    setKind(e.kind);
    setChoice(e.choice ?? '');
    setText(e.text);
    setOpen(true);
  };
  const submit = async () => {
    if (!text.trim() && !choice) return;
    setBusy(true);
    try {
      await save({
        id: editing ?? newId(),
        targetKey: target.key,
        targetType: target.type,
        targetLabel: target.label,
        context: target.context,
        link: target.link,
        kind,
        choice: choice || undefined,
        text: text.trim(),
        author: author.trim() || undefined,
      });
      setEditing(null);
      setOpen(false);
      setChoice('');
      setText('');
    } catch {
      /* the error is shown below; the text stays in the form */
    } finally {
      setBusy(false);
    }
  };
  const kinds: ResponseKind[] = isQuestion ? ['answer', 'question', 'note'] : ['correction', 'decision', 'question', 'note'];
  const showForm = open || (isQuestion && mine.length === 0);

  return (
    <section className={`resp-box ${!showForm && mine.length === 0 ? 'is-empty' : ''}`} data-testid="response-box">
      {(showForm || mine.length > 0) && <h4>{isQuestion ? 'Your answer' : 'Your response'}</h4>}
      {mine.map((e) => (editing === e.id ? null : <Item key={e.id} e={e} onEdit={() => startEdit(e)} />))}
      {!showForm && (
        <button className="btn-quiet" data-testid="response-add" onClick={() => setOpen(true)}>
          {mine.length ? '+ Add another' : '+ Respond to this'}
        </button>
      )}
      {showForm && (
        <div className="resp-form">
          <div className="resp-kinds" role="radiogroup" aria-label="Kind of response">
            {kinds.map((k) => (
              <label key={k} className={kind === k ? 'on' : ''}>
                <input type="radio" name={`kind-${target.key}`} checked={kind === k} onChange={() => setKind(k)} />
                {KIND_LABEL[k]}
              </label>
            ))}
          </div>
          {isQuestion && kind === 'answer' && target.options && target.options.length > 0 && (
            <div className="resp-options">
              {[...target.options, 'Something else (explain below)'].map((o) => (
                <label key={o} className={choice === o ? 'on' : ''}>
                  <input type="radio" name={`choice-${target.key}`} checked={choice === o} onChange={() => setChoice(o)} />
                  <span>{o}</span>
                </label>
              ))}
            </div>
          )}
          <textarea
            data-testid="response-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
            }}
            rows={4}
            placeholder={
              isQuestion
                ? 'Your answer, the reasoning, and any condition or exception…'
                : kind === 'correction'
                  ? 'What is wrong here, and what it should say…'
                  : 'What you want reviewed about this…'
            }
          />
          <div className="resp-foot">
            <input className="resp-author" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Your name (optional)" aria-label="Your name" />
            {(open || editing) && (
              <button
                className="btn-link"
                onClick={() => {
                  setOpen(false);
                  setEditing(null);
                  setText('');
                  setChoice('');
                }}
              >
                Cancel
              </button>
            )}
            <button className="btn" data-testid="response-save" disabled={busy || (!text.trim() && !choice)} onClick={submit} title="Save (⌘ or Ctrl + Enter)">
              {editing ? 'Save changes' : 'Log response'}
            </button>
          </div>
          {error && <p className="resp-error">{error}</p>}
        </div>
      )}
      {(showForm || mine.length > 0) && (
        <p className="resp-hint">
          {mode === 'file'
            ? 'Logged for review. Not a decision until it is recorded in the product workspace.'
            : mode === 'browser'
              ? 'Kept in this browser only. Use Responses › Download to pass it on.'
              : ''}
        </p>
      )}
    </section>
  );
}

function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
function asMarkdown(entries: ResponseEntry[]): string {
  const rows = entries.map(
    (e) =>
      `### ${e.targetLabel}\n\n- Target: ${e.context} · \`${e.targetKey}\`\n- Kind: ${KIND_LABEL[e.kind]}${e.author ? ` · By: ${e.author}` : ''} · Updated: ${e.updatedAt}${e.reviewed ? ' · Reviewed' : ''}\n${e.choice ? `- Chosen option: ${e.choice}\n` : ''}\n${e.text || '(no text)'}\n${e.reply ? `\nReviewer reply: ${e.reply}\n` : ''}`,
  );
  return `# Responses logged in the viewer\n\nThese are responses awaiting review, not recorded product decisions.\n\n${rows.join('\n')}`;
}

/** The list of every response, opened from the top bar. */
export function ResponsesDrawer({ onClose, onOpenLink }: { onClose: () => void; onOpenLink: (hash: string) => void }) {
  const { entries, mode } = useResponses();
  const sorted = [...entries].sort((a, b) => Number(!!a.reviewed) - Number(!!b.reviewed) || b.updatedAt.localeCompare(a.updatedAt));
  const waiting = entries.filter((e) => !e.reviewed).length;
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal resp-drawer" onClick={(e) => e.stopPropagation()} data-testid="responses-drawer">
        <h3>Responses</h3>
        <p className="muted">
          {entries.length} logged · {waiting} awaiting review.{' '}
          {mode === 'file' ? (
            <>
              Saved on this machine in <code>responses/responses.json</code> (readable copy: <code>responses/RESPONSES.md</code>).
            </>
          ) : (
            'Kept in this browser only. Download them to pass them on.'
          )}
        </p>
        <p className="muted">A response is input for review. It becomes a decision only when it is recorded in the product workspace.</p>
        <div className="resp-drawer-actions">
          <button className="btn-quiet" disabled={!entries.length} onClick={() => download('syuzhet-loom-responses.json', JSON.stringify({ version: 1, responses: entries }, null, 2), 'application/json')}>
            Download JSON
          </button>
          <button className="btn-quiet" disabled={!entries.length} onClick={() => download('syuzhet-loom-responses.md', asMarkdown(entries), 'text/markdown')}>
            Download Markdown
          </button>
        </div>
        {sorted.length === 0 && <p>No responses yet. Select an open point, a state or an arrow and use the response box in the panel.</p>}
        {sorted.map((e) => (
          <div key={e.id} className="resp-row">
            <button
              className="resp-target"
              onClick={() => {
                onOpenLink(e.link);
                onClose();
              }}
            >
              {e.targetLabel} <span className="muted">· {e.context}</span>
            </button>
            <Item e={e} onEdit={() => (onOpenLink(e.link), onClose())} />
          </div>
        ))}
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
