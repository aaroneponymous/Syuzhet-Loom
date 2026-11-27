// Read-only Trace section of the details panel: what other layers record about the selected element.
// Statuses are shown as their holders state them; an empty layer says so; nothing here is computed into
// "implemented" or "verified". It makes no network requests.
import { useState, type ReactNode } from 'react';
import { machines } from '../model';
import {
  hrefOf,
  recordOf,
  revisionOf,
  shortLabel,
  trace,
  traceFor,
  workItemText,
  type CoverageGap,
  type Finding,
  type Layer,
  type Link,
  type Related,
  type StatusRecord,
  type TraceRef,
  type WorkItem,
} from '../trace';
import { StalenessBlock } from './Staleness';

const BASIS_TEXT: Record<Link['basis'], string> = { stated: 'stated', derived: 'derived', interpretation: 'interpretation' };
const short = (h: string | null) => (h ? h.replace('sha256:', '').slice(0, 12) : '—');

function Ref({ r }: { r: TraceRef }) {
  const href = hrefOf(r);
  const label = shortLabel(r);
  if (!href) return <code className="tr-ref" title={r}>{label}</code>;
  const external = !href.startsWith('#');
  return (
    <a className="tr-ref" href={href} title={r} {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}>
      {label}
    </a>
  );
}

function Statuses({ rec }: { rec?: StatusRecord }) {
  if (!rec) return null;
  return (
    <span className="tr-statuses">
      {rec.statuses.map((s, i) => (
        <span key={i} className={`tr-status tr-status-${s.kind}`} title={`Held in ${s.heldIn}`}>
          {s.value}
        </span>
      ))}
    </span>
  );
}

function Basis({ l }: { l: Link }) {
  return <span className={`tr-basis tr-basis-${l.basis}`}>{BASIS_TEXT[l.basis]}</span>;
}

function GapRow({ g, via }: { g: CoverageGap; via?: TraceRef }) {
  const rev = g.checked ? revisionOf(g.checked.rev) : undefined;
  return (
    <li className="tr-gap" data-testid={`trace-gap-${g.id}`}>
      <span className={`tr-gapkind tr-gapkind-${g.kind}`}>{g.kind === 'checked-absent' ? 'Checked: none found' : 'Outside this increment'}</span>{' '}
      <span className="muted">
        {g.id}
        {via && (
          <>
            {' '}
            · for <Ref r={via} />
          </>
        )}
      </span>
      <div className="tr-gap-reason">{g.reason}</div>
      {g.checked && (
        <div className="muted tr-small">
          Source checked: {g.checked.source}
          {rev ? ` · revision: ${rev.version.length === 40 ? rev.version.slice(0, 7) : rev.version} · ${rev.checkedAt}` : ''}
        </div>
      )}
    </li>
  );
}

/** A layer with links or gaps. A layer with neither is not drawn; it is named once in "No link recorded". */
function LayerBlock({ layer, title, children, empty, gaps }: { layer: Layer; title: string; children?: ReactNode; empty: boolean; gaps: Related<CoverageGap>[] }) {
  const mine = gaps.filter((g) => g.item.expected.layer === layer);
  if (empty && mine.length === 0) return null;
  return (
    <div className="tr-layer" data-testid={`trace-layer-${layer}`}>
      <div className="tr-layer-title">{title}</div>
      {children}
      {mine.length > 0 && (
        <ul className="tr-list">
          {mine.map((g) => (
            <GapRow key={g.item.id + (g.via ?? '')} g={g.item} via={g.via} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FindingCard({ f, related }: { f: Finding; related?: boolean }) {
  return (
    <li className={`tr-finding${related ? ' tr-finding-related' : ''}`} data-testid={related ? 'trace-finding-related' : 'trace-finding-direct'} data-finding={f.id}>
      <div>
        <b>{f.id}</b> {f.title} <span className="tr-status">{f.status}</span>
      </div>
      {!related && (
        <>
          <p className="tr-small">{f.what}</p>
          <p className="tr-small">
            <i>Consequence:</i> {f.consequence}
          </p>
        </>
      )}
      <div className="muted tr-small">
        On:{' '}
        {f.targets.map((t, i) => (
          <span key={t}>
            {i > 0 && ', '}
            <Ref r={t} />
          </span>
        ))}
        {' · '}scenarios:{' '}
        {f.scenarios.map((s, i) => (
          <span key={s}>
            {i > 0 && ', '}
            <Ref r={s} />
          </span>
        ))}
      </div>
    </li>
  );
}

function WorkItemCard({ w }: { w: WorkItem }) {
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const text = workItemText(w);
  const copy = () => {
    const done = () => setCopied('done');
    const failed = () => setCopied('failed');
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, failed);
    else failed();
  };
  return (
    <li className="tr-wi" data-testid="trace-wi" data-wi={w.id}>
      <div>
        <b>{w.id}</b> <span className="tr-wi-state" data-testid="wi-status">{w.state === 'draft' ? 'Draft — not sent' : w.state}</span>{' '}
        <span className="muted">for {w.findings.join(', ')}</span>
      </div>
      <div className="tr-small">{w.title}</div>
      <div className="tr-wi-actions">
        <button className="btn-quiet" data-testid="wi-copy" onClick={copy}>
          {copied === 'done' ? 'Copied' : 'Copy text'}
        </button>
        {copied === 'failed' && <span className="muted tr-small">Copying is not available here; select the text below.</span>}
      </div>
      <details className="tr-wi-text">
        <summary>Show text</summary>
        <pre data-testid="wi-text">{text}</pre>
      </details>
      <p className="muted tr-small">Creating an issue from it in {w.system} is a separate, approved step.</p>
    </li>
  );
}

export function TraceSection({ machineId, elementId, uses }: { machineId: string; elementId?: string; uses?: string }) {
  const v = traceFor(machineId, elementId, uses);
  const title = (id?: string) => (id ? machines[id]?.title ?? id : '');
  const baseline = trace.baseline.modelCommit.slice(0, 7);
  const hashNote = !v.hash.recorded ? 'is not recorded in the trace' : v.hash.now === v.hash.recorded ? `matches baseline ${baseline}` : `differs from baseline ${baseline}`;

  // nothing in the trace touches this element: one line, and no staleness block with nothing to compare
  if (!v.hasAny)
    return (
      <section className="trace" data-testid="trace">
        <h4>Trace</h4>
        <p className="muted" data-testid="trace-untraced">
          Not traced yet.{trace.scope ? ` The trace covers ${trace.scope} only.` : ''}
        </p>
      </section>
    );

  const allGaps: Related<CoverageGap>[] = [...v.gaps, ...v.componentGaps.map((item) => ({ item, via: item.anchor === v.ref ? undefined : item.anchor }))];
  const designMap = v.designs.filter((d) => d.item.from.ref.startsWith('design-map:'));
  const frames = v.designs.filter((d) => d.item.from.ref.startsWith('figma:'));
  const hasGap = (layer: Layer) => allGaps.some((g) => g.item.expected.layer === layer);
  const hasVerification = v.scenarioDefs.length + v.testDefs.length + v.runs.length > 0 || hasGap('verification');
  const emptyLayers = (
    [
      ['product', 'Product approval', v.approvals.length],
      ['handoff', 'Handoff', v.refines.length],
      ['design', 'Design', v.designs.length],
      ['architecture', 'Architecture', v.allocates.length],
      ['implementation', 'Implementation', v.evidence.length],
      ['verification', 'Verification', hasVerification ? 1 : 0],
      ['research', 'Research', 0],
      ['work', 'Work items', v.workItems.length],
    ] as [Layer, string, number][]
  )
    .filter(([layer, , n]) => n === 0 && !hasGap(layer))
    .map(([, name]) => name);

  return (
    <section className="trace" data-testid="trace">
      <h4>
        Trace
      </h4>
      <p
        className="muted tr-small"
        data-testid="trace-hash"
        title="The hash covers this element's own definition only. It does not show that the decisions it cites, its machine's rules or what it depends on are unchanged."
      >
        Element hash <code>{short(v.hash.now)}</code> {hashNote} (this element only).
      </p>

      <StalenessBlock view={v} machineId={machineId} elementId={elementId} uses={uses} />

      <LayerBlock layer="product" title="Product approval" empty={v.approvals.length === 0} gaps={allGaps}>
        {v.approvals.length > 0 && (
          <ul className="tr-list">
            {v.approvals.map((r) => (
              <li key={r.ref}>
                {hrefOf(r.ref) ? (
                  <a className="tr-ref" href={hrefOf(r.ref)!} target="_blank" rel="noreferrer noopener" title={r.ref}>
                    {r.title}
                  </a>
                ) : (
                  r.title
                )}{' '}
                <Statuses rec={r} />
                <span className="muted tr-small"> · {r.statuses[0].heldIn}, checked {revisionOf(r.rev)?.checkedAt}</span>
                {v.approvalsVia && <span className="muted tr-small"> · applies through {title(v.approvalsVia)}</span>}
              </li>
            ))}
          </ul>
        )}
      </LayerBlock>

      <LayerBlock layer="handoff" title="Handoff (pinned version)" empty={v.refines.length === 0} gaps={allGaps}>
        {v.refines.length > 0 && (
          <ul className="tr-list">
            {v.refines.map((l) => (
              <li key={l.id}>
                <Ref r={l.from.ref} /> refines this <Basis l={l} /> <Statuses rec={recordOf(l.from.ref)} />
              </li>
            ))}
          </ul>
        )}
      </LayerBlock>

      <LayerBlock layer="design" title="Design" empty={v.designs.length === 0} gaps={allGaps}>
        {designMap.length > 0 && (
          <ul className="tr-list">
            {designMap.map(({ item, via }) => (
              <li key={item.id}>
                <Ref r={item.from.ref} /> <Statuses rec={recordOf(item.from.ref)} />
                <span className="muted tr-small"> · via {shortLabel(via!)}</span>
              </li>
            ))}
          </ul>
        )}
        {frames.length > 0 && (
          <ul className="tr-list">
            {frames.map(({ item, via }) => (
              <li key={item.id}>
                Figma <Ref r={item.from.ref} /> {recordOf(item.from.ref)?.title} <Statuses rec={recordOf(item.from.ref)} />
                <span className="muted tr-small"> · via {shortLabel(via!)}</span>
              </li>
            ))}
          </ul>
        )}
      </LayerBlock>

      <LayerBlock layer="architecture" title="Architecture" empty={v.allocates.length === 0} gaps={allGaps}>
        {v.allocates.length > 0 && (
          <ul className="tr-list">
            {v.allocates.map((l) => (
              <li key={l.id}>
                <Ref r={l.to.ref} /> <Basis l={l} /> <span className="muted tr-small">shares {l.sharedRefs?.join(', ')}</span> <Statuses rec={recordOf(l.to.ref)} />
              </li>
            ))}
          </ul>
        )}
      </LayerBlock>

      <LayerBlock layer="implementation" title="Implementation" empty={v.evidence.length === 0} gaps={allGaps}>
        {v.evidence.length > 0 && (
          <>
            <div className="tr-sub">Code elsewhere: evidence only, not an implementation of this element</div>
            <ul className="tr-list">
              {v.evidence.map(({ item, via }) => (
                <li key={item.id}>
                  <Ref r={item.from.ref} /> → {shortLabel(via!)} <Basis l={item} />
                  <div className="muted tr-small">{item.note}</div>
                </li>
              ))}
            </ul>
          </>
        )}
      </LayerBlock>

      <LayerBlock layer="verification" title="Verification" empty={!hasVerification} gaps={allGaps}>
        {v.scenarioDefs.length > 0 && <div className="tr-sub">Scenario definitions</div>}
        {v.scenarioDefs.length > 0 && (
          <ul className="tr-list">
            {v.scenarioDefs.map((s) => (
              <li key={s.ref}>
                <Ref r={s.ref} /> {s.source === 'model' ? s.title : ''} <span className="tr-basis tr-basis-stated">covers</span>
                <span className="muted tr-small">{s.steps ? ` · step ${s.steps.join(', ')} (model)` : ' · handoff scenario'}</span>
              </li>
            ))}
          </ul>
        )}
        {v.testDefs.length > 0 && <div className="tr-sub">Test definitions</div>}
        {v.testDefs.length > 0 && (
          <ul className="tr-list">
            {v.testDefs.map(({ item }) => (
              <li key={item.id}>
                <Ref r={item.from.ref} /> <span className="tr-basis tr-basis-interpretation">tests</span> the evidence code
                <div className="muted tr-small">{item.note}</div>
              </li>
            ))}
          </ul>
        )}
        {v.runs.length > 0 && <div className="tr-sub">Check runs</div>}
        {v.runs.length ? (
          <ul className="tr-list">
            {v.runs.map((r) => (
              <li key={r.id}>
                {r.id} of <Ref r={r.of} />: <b>{r.result}</b> <span className="muted tr-small">· {r.ranAt}, by {r.by}, against {r.revisions.join(', ')}</span>
              </li>
            ))}
          </ul>
        ) : (
          v.scenarioDefs.length + v.testDefs.length > 0 && (
            <p className="muted tr-none" data-testid="trace-no-runs">
              No check run recorded, so there is no result.
            </p>
          )
        )}
      </LayerBlock>

      <LayerBlock layer="research" title="Research" empty gaps={allGaps} />

      {v.direct.length + v.related.length > 0 && (
        <div className="tr-layer" data-testid="trace-findings">
          <div className="tr-layer-title">Findings</div>
          {v.direct.length > 0 && (
            <ul className="tr-list">
              {v.direct.map((f) => (
                <FindingCard key={f.id} f={f} />
              ))}
            </ul>
          )}
          {v.related.length > 0 && (
            <>
              <div className="tr-sub">Related through component{v.relatedVia ? `: ${title(v.relatedVia)}` : ''}</div>
              <ul className="tr-list">
                {v.related.map((f) => (
                  <FindingCard key={f.id} f={f} related />
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <LayerBlock layer="work" title="Work items" empty={v.workItems.length === 0} gaps={allGaps}>
        {v.workItems.length > 0 && (
          <ul className="tr-list" data-testid="trace-work">
            {v.workItems.map((w) => (
              <WorkItemCard key={w.id} w={w} />
            ))}
          </ul>
        )}
      </LayerBlock>

      {emptyLayers.length > 0 && (
        <p className="muted tr-small" data-testid="trace-empty-layers">
          No link recorded: {emptyLayers.join(', ')}.
        </p>
      )}
    </section>
  );
}
