// Staleness of the selection, from the generated report: whether its pinned references still match, whether
// later inspected versions changed them, and what needs review. Read-only; makes no requests. An unchanged
// element hash is shown as one fact among others, never as an overall "current" badge.
import { machines } from '../model';
import { recordOf, type TraceView } from '../trace';
import { shortLabel } from '../trace/refs';
import { laterSentence, pinnedSentence, reportState, stalenessFor, type ReportAffected, type ReportState, type Verdict } from '../trace/staleness';

const VERDICT: Record<Verdict, string> = {
  'needs-review': 'Needs review',
  incomplete: 'Comparison incomplete or source unavailable',
  'no-change': 'No change detected within the checked scope',
  'no-coverage': 'No report coverage for this element',
};

const when = (iso: string) => iso.replace('T', ' ').replace(/\.\d+Z$/, ' UTC');

function ReviewItem({ a }: { a: ReportAffected }) {
  return (
    <li data-testid={`stale-review-${a.subject}`} data-id={a.id}>
      <b>{a.subject === 'record' ? shortLabel(a.id) : a.id}</b> <span className="st-flag">Needs review</span> <span className="muted tr-small">{a.subject.replace('-', ' ')}</span>
      {a.reasons.slice(0, 2).map((r, i) => (
        <div key={i} className="muted tr-small st-path">
          {r.path}
        </div>
      ))}
      {a.reasons.length > 2 && <div className="muted tr-small">… {a.reasons.length - 2} more in the report</div>}
    </li>
  );
}

function ReportHeader({ s }: { s: ReportState }) {
  if (s.state === 'missing')
    return (
      <p className="muted tr-small" data-testid="stale-report" data-status="missing">
        No staleness report was found when the viewer was built. Generate one with <code>npm run trace-staleness</code>, then rebuild or restart the viewer.
      </p>
    );
  if (s.state === 'invalid')
    return (
      <p className="muted tr-small" data-testid="stale-report" data-status="invalid">
        The staleness report could not be read: {s.error}. Regenerate it with <code>npm run trace-staleness</code>.
      </p>
    );
  const r = s.report;
  // warnings stay visible; when and how the report was made is folded away
  return (
    <div data-testid="stale-report" data-status={s.outdated.length ? 'outdated' : 'loaded'}>
      {s.outdated.length > 0 && (
        <p className="st-outdated" data-testid="stale-outdated">
          <b>Report out of date:</b> {s.outdated.join('; ')}. Regenerate with <code>npm run trace-staleness</code>.
        </p>
      )}
      {!r.inspection.stable && <p className="muted tr-small">Unstable snapshot: some sources changed during the scan.</p>}
      <details className="tr-small st-scope">
        <summary>Report of {when(r.generatedAt).slice(0, 10)}</summary>
        <p className="muted">
          Generated {when(r.generatedAt)}
          {r.inspection.snapshotId && <> · snapshot <code data-testid="stale-snapshot">{r.inspection.snapshotId}</code></>}. Compares local files and commits; external services (Notion, Figma) are not read.
        </p>
        <ul>
          {r.scope.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export function StalenessBlock({ view, machineId, elementId, uses }: { view: TraceView; machineId: string; elementId?: string; uses?: string }) {
  const s = reportState;
  if (s.state !== 'loaded')
    return (
      <div className="tr-layer st" data-testid="staleness">
        <div className="tr-layer-title">Since pinned</div>
        <ReportHeader s={s} />
      </div>
    );
  const st = stalenessFor(s.report, view, machineId, elementId, uses);
  const withEntry = st.pinned.filter((l) => l.entry);
  const matching = withEntry.filter((l) => l.entry!.integrity.status === 'matches');
  const pinnedProblems = withEntry.filter((l) => l.entry!.integrity.status !== 'matches');
  const laterNotable = withEntry.filter((l) => !['no-later', 'later-unchanged', 'not-versioned'].includes(l.entry!.later.status) || l.entry!.later.provisional);
  const laterQuiet = withEntry.filter((l) => !laterNotable.includes(l));
  const missingFromReport = st.pinned.filter((l) => !l.entry);
  const title = (id?: string) => (id ? machines[id]?.title ?? id : '');

  return (
    <div className="tr-layer st" data-testid="staleness">
      <div className="tr-layer-title">Since pinned</div>
      <ReportHeader s={s} />
      <p className={`st-verdict st-${st.verdict}`} data-testid="stale-verdict" data-verdict={st.verdict}>
        {VERDICT[st.verdict]}
        {s.outdated.length > 0 && ' (report out of date)'}
      </p>

      {st.pinned.length > 0 && <div className="tr-sub">Pinned references</div>}
      <div data-testid="stale-pinned">
        {matching.length > 0 && (
          <details className="tr-small">
            <summary>
              {matching.length} pinned reference{matching.length > 1 ? 's' : ''} resolve and match
            </summary>
            <ul className="tr-list">
              {matching.map((l) => (
                <li key={l.ref}>
                  <code className="tr-ref">{shortLabel(l.ref)}</code> {pinnedSentence(l.entry!)}
                </li>
              ))}
            </ul>
          </details>
        )}
        <ul className="tr-list">
          {pinnedProblems.map((l) => (
            <li key={l.ref} data-ref={l.ref}>
              <code className="tr-ref">{shortLabel(l.ref)}</code> {pinnedSentence(l.entry!)} <span className="muted tr-small">{l.entry!.integrity.detail}</span>
            </li>
          ))}
          {missingFromReport.map((l) => (
            <li key={l.ref} className="muted">
              <code className="tr-ref">{shortLabel(l.ref)}</code> not in the report yet
            </li>
          ))}
        </ul>
      </div>

      {withEntry.length > 0 && <div className="tr-sub">Later versions</div>}
      <ul className="tr-list" data-testid="stale-later">
        {laterNotable.map((l) => (
          <li key={l.ref} data-ref={l.ref} data-later={l.entry!.later.status}>
            <code className="tr-ref">{shortLabel(l.ref)}</code> {pinnedSentence(l.entry!)} {laterSentence(l.entry!)} {l.flagged && <span className="st-flag">Needs review.</span>}
            <div className="muted tr-small">{l.entry!.later.detail}</div>
          </li>
        ))}
      </ul>
      {laterQuiet.length > 0 && (
        <details className="tr-small">
          <summary>{laterQuiet.length} with no change detected</summary>
          <ul className="tr-list">
            {laterQuiet.map((l) => (
              <li key={l.ref}>
                <code className="tr-ref">{shortLabel(l.ref)}</code> {laterSentence(l.entry!)}
                {l.entry!.dependencies && (
                  <span className="muted">
                    {' '}
                    Dependencies checked: {l.entry!.dependencies.checked.filter((d) => d.status === 'unchanged').length} unchanged of {l.entry!.dependencies.checked.length}; not checked: {l.entry!.dependencies.unchecked.length}.
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {st.review.length > 0 && <div className="tr-sub">Needs review</div>}
      <ul className="tr-list" data-testid="stale-review">
        {st.review.map((a) => (
          <ReviewItem key={a.subject + a.id} a={a} />
        ))}
      </ul>
      {st.related.length > 0 && (
        <>
          <div className="tr-sub">Related through component{st.relatedVia ? `: ${title(st.relatedVia)}` : ''}</div>
          <ul className="tr-list" data-testid="stale-related">
            {st.related.map((a) => (
              <ReviewItem key={a.subject + a.id} a={a} />
            ))}
          </ul>
        </>
      )}

      {st.notInScope.length > 0 && (
        <p className="muted tr-small" data-testid="stale-not-in-scope">
          Not checked by the report (source not read):{' '}
          {st.notInScope.map((l, i) => (
            <span key={l.ref}>
              {i > 0 && '; '}
              {recordOf(l.ref)?.title ?? shortLabel(l.ref)}
              {l.entry ? `: ${l.entry.integrity.detail.replace(/^Notion is not read by this report; /, '')}` : ''}
            </span>
          ))}
          .
        </p>
      )}
    </div>
  );
}
