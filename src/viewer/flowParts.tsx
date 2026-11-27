import { createContext, useContext } from 'react';
import { BaseEdge, EdgeLabelRenderer, Handle, Position } from '@xyflow/react';
import type { EdgeProps, NodeProps, Node, Edge } from '@xyflow/react';
import type { MapEdgeData, MapNodeData, Pt } from './graph';
import { useResponses } from './responses';
import { EDGE } from './theme';

export interface ViewActions {
  selected: string | null;
  expanded: Set<string>;
  select: (path: string) => void;
  toggle: (path: string) => void;
  focus: (machineId: string) => void;
  clear: () => void;
}
export const ViewCtx = createContext<ViewActions>({
  selected: null,
  expanded: new Set(),
  select: () => {},
  toggle: () => {},
  focus: () => {},
  clear: () => {},
});

/**
 * How strongly an element is drawn.
 * 'dim': not part of what is selected, or filtered out. 'side': a side path while the main path is emphasised.
 */
export type Emphasis = 'normal' | 'dim' | 'side';
export const EmphasisCtx = createContext<(id: string) => Emphasis>(() => 'normal');

const ACTOR_TITLE: Record<string, string> = { user: 'The person does this', app: 'The app does this', time: 'Time passing causes this', unstated: 'The sources do not say who causes this' };
/** A small mark for who or what causes an event. */
export function ActorIcon({ actor }: { actor?: string }) {
  if (!actor) return null;
  const common = { width: 11, height: 11, viewBox: '0 0 12 12', className: `actor actor-${actor}`, 'aria-label': ACTOR_TITLE[actor] } as const;
  return (
    <span className="actor-wrap" title={ACTOR_TITLE[actor]}>
      {actor === 'user' && (
        <svg {...common}>
          <circle cx="6" cy="3.6" r="2.3" fill="currentColor" />
          <path d="M1.6 11.2c0-2.6 2-4.2 4.4-4.2s4.4 1.6 4.4 4.2z" fill="currentColor" />
        </svg>
      )}
      {actor === 'app' && (
        <svg {...common}>
          <rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <rect x="4.6" y="4.6" width="2.8" height="2.8" fill="currentColor" />
        </svg>
      )}
      {actor === 'time' && (
        <svg {...common}>
          <circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M6 3.4V6l1.9 1.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      )}
      {actor === 'unstated' && (
        <svg {...common}>
          <circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 1.6" />
          <text x="6" y="8.4" fontSize="6.5" fontWeight="700" textAnchor="middle" fill="currentColor">
            ?
          </text>
        </svg>
      )}
    </span>
  );
}

const KIND_LABEL: Record<string, string> = {
  journey: 'Journey',
  shared: 'Shared component',
  entity: 'Record lifecycle',
  boundary: 'Not modelled',
  overview: 'Overview',
};

const Hidden = () => (
  <>
    <Handle type="target" position={Position.Left} className="hidden-handle" isConnectable={false} />
    <Handle type="source" position={Position.Right} className="hidden-handle" isConnectable={false} />
  </>
);

const stop = (fn: () => void) => (e: React.MouseEvent) => {
  e.stopPropagation();
  fn();
};

export function MapNode({ data }: NodeProps<Node<MapNodeData>>) {
  const { selected, select, toggle, focus } = useContext(ViewCtx);
  const { variant, label, path, state, sub, openCount } = data;
  const em = useContext(EmphasisCtx)(`n:${path}`);
  const { counts } = useResponses();
  const nResp = state ? (counts.get(`e:${data.machineId}/${state.id}`) ?? 0) + (sub ? (counts.get(`m:${sub.id}`) ?? 0) : 0) : 0;
  const respDot = nResp > 0 ? <span className="resp-dot" title={`${nResp} response${nResp > 1 ? 's' : ''} logged`}>{nResp}</span> : null;
  const isSel = selected === path && path !== '';
  const open = !!state?.open;
  const interp = !!state?.interpretation;
  const cls = (base: string) =>
    [base, isSel ? 'is-selected' : '', open ? 'is-open' : '', interp ? 'is-interp' : '', !isSel && em !== 'normal' ? `em-${em}` : ''].filter(Boolean).join(' ');

  if (variant === 'lane') return <div className="lane-title">{label}</div>;

  if (variant === 'initial')
    return (
      <div className={`node-initial ${em !== 'normal' ? `em-${em}` : ''}`} title="Start">
        <Hidden />
      </div>
    );

  if (variant === 'group' && sub)
    return (
      <div className={cls(`node-group kind-${sub.kind}`)} data-testid={`group-${path}`}>
        <Hidden />
        <div className="group-header" onClick={stop(() => select(path))}>
          <button className="icon-btn" title="Collapse" aria-label={`Collapse ${label}`} onClick={stop(() => toggle(path))}>
            ▾
          </button>
          <span className="group-title">{label}</span>
          {state?.multiplicity && <span className="group-mult">× {state.multiplicity}</span>}
          {open && <span className="badge-open">OPEN</span>}
          {respDot}
          <button className="icon-btn" title="Open in focused view" aria-label={`Focus ${label}`} onClick={stop(() => focus(sub.id))}>
            ⤢
          </button>
        </div>
      </div>
    );

  if (variant === 'boundary')
    return (
      <div className={cls('node-boundary')} onClick={stop(() => select(path))} data-testid={`node-${path}`}>
        <Hidden />
        <span>{label}</span>
        {respDot && <span className="resp-corner">{respDot}</span>}
      </div>
    );

  if (variant === 'composite' && sub)
    return (
      <div
        className={cls(`node-composite kind-${sub.kind}`)}
        onClick={stop(() => select(path))}
        onDoubleClick={stop(() => focus(sub.id))}
        data-testid={`node-${path}`}
      >
        <Hidden />
        <button className="icon-btn" title="Expand in place" aria-label={`Expand ${label}`} onClick={stop(() => toggle(path))}>
          ▸
        </button>
        <div className="composite-body">
          <div className="composite-title">{label}</div>
          {state?.multiplicity && <div className="composite-mult">× {state.multiplicity}</div>}
        </div>
        {openCount > 0 && (
          <span className="open-count" title={`${openCount} undecided point${openCount > 1 ? 's' : ''} inside`}>
            {openCount}
          </span>
        )}
        <button className="icon-btn" title="Open in focused view" aria-label={`Focus ${label}`} onClick={stop(() => focus(sub.id))}>
          ⤢
        </button>
        {open && <span className="badge-open corner">OPEN</span>}
        {respDot && <span className="resp-corner">{respDot}</span>}
      </div>
    );

  return (
    <div className={cls(`node-state variant-${variant}`)} onClick={stop(() => select(path))} data-testid={`node-${path}`}>
      <Hidden />
      <span>{label}</span>
      {open && <span className="badge-open corner">OPEN</span>}
      {respDot && <span className="resp-corner">{respDot}</span>}
    </div>
  );
}

function pathThrough(pts: Pt[]): string {
  if (pts.length < 2) return '';
  if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    d += ` Q ${pts[i].x} ${pts[i].y} ${mx} ${my}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

export function MapEdge({ data, markerEnd }: EdgeProps<Edge<MapEdgeData>>) {
  const { selected, select } = useContext(ViewCtx);
  const { counts } = useResponses();
  const level = useContext(EmphasisCtx);
  if (!data) return null;
  const nResp = counts.get(`e:${data.machineId}/${data.tr.id}`) ?? 0;
  const { tr, points, label, selPath, quiet } = data;
  const isSel = selected === selPath;
  const em = isSel ? 'normal' : level(`e:${selPath}`);
  const open = !!tr.open;
  const sig = tr.kind === 'signal';
  const stroke = isSel ? EDGE.selected : open ? EDGE.open : sig ? EDGE.signal : EDGE.normal;
  return (
    <>
      <BaseEdge
        path={pathThrough(points)}
        markerEnd={markerEnd}
        interactionWidth={18}
        style={{
          stroke,
          strokeWidth: isSel ? 2.4 : tr.flow === 'main' && !sig ? 1.9 : 1.3,
          opacity: em === 'dim' ? 0.12 : em === 'side' ? 0.34 : 1,
          strokeDasharray: open ? '7 5' : sig ? '2 4' : undefined,
          fill: 'none',
        }}
      />
      <EdgeLabelRenderer>
        <div
          title={quiet ? tr.event : undefined}
          className={['edge-label', quiet && !nResp ? 'is-quiet' : '', isSel ? 'is-selected' : '', open ? 'is-open' : '', sig ? 'is-signal' : '', tr.flow === 'main' ? 'is-main' : '', em !== 'normal' ? `em-${em}` : '']
            .filter(Boolean)
            .join(' ')}
          style={{ transform: `translate(-50%, -50%) translate(${label.x}px, ${label.y}px)` }}
          onClick={stop(() => select(selPath))}
          data-testid={`edge-${selPath}`}
        >
          <ActorIcon actor={tr.actor} />
          <span className="edge-text">{tr.event}</span>
          {open && <span className="badge-open tiny">OPEN</span>}
          {nResp > 0 && <span className="resp-dot tiny" title="Response logged">{nResp}</span>}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
