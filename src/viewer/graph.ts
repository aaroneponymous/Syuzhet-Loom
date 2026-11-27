// Turns the model into positioned nodes and routed edges for React Flow.
// Layout is recursive: an expanded composite is laid out first, then placed in its parent
// as one box of that size. A transition that crosses the boundary of an expanded composite
// is drawn on to the mapped entry state (or from the mapped exit state), so the connection
// means the same thing expanded or collapsed.
import dagre from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';
import { MarkerType } from '@xyflow/react';
import { machines } from '../model';
import type { MachineDef, StateDef, TransitionDef } from '../model/types';
import { EDGE } from './theme';

export interface Pt {
  x: number;
  y: number;
}
interface Rect extends Pt {
  w: number;
  h: number;
}

export type NodeVariant = 'state' | 'initial' | 'final' | 'choice' | 'composite' | 'boundary' | 'group' | 'lane';

export interface MapNodeData extends Record<string, unknown> {
  variant: NodeVariant;
  label: string;
  path: string; // instance path of the state, '' for lane headers
  machineId: string; // machine that owns the state
  state?: StateDef;
  sub?: MachineDef; // machine used by a composite
  openCount: number;
  /** true when no main-path event touches this state (it is reached only by side paths) */
  sideOnly: boolean;
  width: number;
  height: number;
}

export interface MapEdgeData extends Record<string, unknown> {
  points: Pt[];
  label: Pt;
  tr: TransitionDef;
  machineId: string;
  selPath: string;
  /** true in the overview map: the label stays a dot until hovered or selected */
  quiet: boolean;
}

const PAD = 18;
const HEADER = 40;
const textW = (s: string, px = 13) => Math.ceil(s.length * px * 0.56);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const openCountCache = new Map<string, number>();
/** Number of open marks inside a machine, including machines it uses. */
export function openCount(id: string, seen: string[] = []): number {
  if (seen.includes(id)) return 0;
  const cached = openCountCache.get(id);
  if (cached !== undefined) return cached;
  const m = machines[id];
  if (!m) return 0;
  let n = 0;
  for (const s of m.states) {
    if (s.open) n++;
    if (s.uses) n += openCount(s.uses, [...seen, id]);
  }
  for (const t of m.transitions) if (t.open) n++;
  openCountCache.set(id, n);
  return n;
}

interface Item extends Rect {
  state: StateDef;
  path: string;
  variant: NodeVariant;
  sub?: MachineDef;
  child?: Layout;
}
interface LEdge {
  tr: TransitionDef;
  points: Pt[];
  label: Pt;
}
interface Layout {
  machine: MachineDef;
  prefix: string;
  w: number;
  h: number;
  items: Item[];
  edges: LEdge[];
  lanes: { title: string; x: number; y: number }[];
}

const join = (prefix: string, id: string) => (prefix ? `${prefix}/${id}` : id);

function clip(r: Rect, toward: Pt): Pt {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = dx === 0 ? Infinity : r.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : r.h / 2 / Math.abs(dy);
  const k = Math.min(sx, sy);
  return { x: cx + dx * k, y: cy + dy * k };
}

function layoutMachine(machine: MachineDef, prefix: string, expanded: Set<string>): Layout {
  const items: Item[] = machine.states.map((state) => {
    const path = join(prefix, state.id);
    const sub = state.uses ? machines[state.uses] : undefined;
    if (sub && sub.kind !== 'boundary' && expanded.has(path)) {
      const child = layoutMachine(sub, path, expanded);
      const w = Math.max(child.w + PAD * 2, textW(state.label, 14) + textW(state.multiplicity ?? '', 11) + 110);
      return { state, path, sub, child, variant: 'group', x: 0, y: 0, w, h: child.h + HEADER + PAD };
    }
    if (sub?.kind === 'boundary')
      return { state, path, sub, variant: 'boundary', x: 0, y: 0, w: clamp(textW(state.label) + 34, 150, 240), h: 34 };
    if (sub) {
      const open = openCount(sub.id) > 0 ? 30 : 0;
      return {
        state,
        path,
        sub,
        variant: 'composite',
        x: 0,
        y: 0,
        w: clamp(Math.max(textW(state.label, 15.5), textW(state.multiplicity ?? '', 11.5) + 12) + 84 + open, 170, 340),
        h: state.multiplicity ? 60 : 46,
      };
    }
    if (state.kind === 'initial') return { state, path, variant: 'initial', x: 0, y: 0, w: 18, h: 18 };
    const variant: NodeVariant = state.kind === 'final' ? 'final' : state.kind === 'choice' ? 'choice' : 'state';
    return { state, path, variant, x: 0, y: 0, w: clamp(textW(state.label) + 40, 96, 240), h: 40 };
  });
  const byId = new Map(items.map((i) => [i.state.id, i]));
  const edges: LEdge[] = [];
  const lanes: Layout['lanes'] = [];
  let w = 0;
  let h = 0;

  const hasLanes = machine.states.some((s) => s.lane);
  if (hasLanes) {
    // columns, one per lane, in order of first appearance
    const order: string[] = [];
    for (const s of machine.states) if (!order.includes(s.lane ?? '')) order.push(s.lane ?? '');
    let x = 0;
    for (const lane of order) {
      const col = items.filter((i) => (i.state.lane ?? '') === lane);
      const split = col.length > 9 ? Math.ceil(col.length / 2) : col.length;
      const colW = Math.max(...col.map((i) => i.w), textW(lane, 12) + 10);
      lanes.push({ title: lane, x, y: 0 });
      let y = 34;
      let cx = x;
      col.forEach((it, idx) => {
        if (idx === split) {
          cx += colW + 16;
          y = 34;
        }
        it.x = cx;
        it.y = y;
        y += it.h + 16;
        h = Math.max(h, y);
      });
      x = cx + colW + 170;
      w = Math.max(w, cx + colW);
    }
    for (const tr of machine.transitions) {
      const a = byId.get(tr.from)!;
      const b = byId.get(tr.to)!;
      const ay = a.y + a.h / 2;
      const by = b.y + b.h / 2;
      let pts: Pt[];
      if (Math.abs(a.x - b.x) < 10) {
        // same column: bow out to the right
        const x = Math.max(a.x + a.w, b.x + b.w);
        pts = [{ x: a.x + a.w, y: ay }, { x: x + 44, y: ay }, { x: x + 44, y: by }, { x: b.x + b.w, y: by }];
      } else {
        const fwd = a.x < b.x;
        const p0 = { x: fwd ? a.x + a.w : a.x, y: ay };
        const p1 = { x: fwd ? b.x : b.x + b.w, y: by };
        const dx = (p1.x - p0.x) * 0.45;
        pts = [p0, { x: p0.x + dx, y: p0.y }, { x: p1.x - dx, y: p1.y }, p1];
      }
      const mid = pts.length === 4 ? { x: (pts[1].x + pts[2].x) / 2, y: (pts[1].y + pts[2].y) / 2 } : pts[1];
      edges.push({ tr, points: pts, label: mid });
    }
  } else {
    // Lay out both left-to-right and top-to-bottom; keep whichever is closer to the canvas shape.
    const run = (rankdir: 'LR' | 'TB') => {
      const g = new dagre.graphlib.Graph({ multigraph: true });
      g.setGraph({ rankdir, nodesep: rankdir === 'LR' ? 26 : 34, ranksep: rankdir === 'LR' ? 60 : 46, edgesep: 18, marginx: 6, marginy: 6 });
      g.setDefaultEdgeLabel(() => ({}));
      for (const it of items) g.setNode(it.state.id, { width: it.w, height: it.h });
      for (const tr of machine.transitions)
        g.setEdge(tr.from, tr.to, { width: textW(tr.event, 11) + 18, height: 20, labelpos: 'c' }, tr.id);
      dagre.layout(g);
      const gg = g.graph();
      return { g, w: gg.width ?? 0, h: gg.height ?? 0 };
    };
    const TARGET = 1.5;
    const score = (r: { w: number; h: number }) => Math.abs(Math.log(r.w / Math.max(r.h, 1) / TARGET));
    const lr = run('LR');
    const tb = run('TB');
    const best = score(lr) <= score(tb) ? lr : tb;
    const g = best.g;
    for (const it of items) {
      const n = g.node(it.state.id);
      it.x = n.x - it.w / 2;
      it.y = n.y - it.h / 2;
    }
    for (const tr of machine.transitions) {
      const e = g.edge({ v: tr.from, w: tr.to, name: tr.id });
      edges.push({ tr, points: e.points.map((p: Pt) => ({ x: p.x, y: p.y })), label: { x: e.x ?? e.points[1].x, y: e.y ?? e.points[1].y } });
    }
    w = best.w;
    h = best.h;
  }
  return { machine, prefix, w, h, items, edges, lanes };
}

/** Follows an entry or exit mapping down through expanded composites. Returns the instance path it lands on. */
function resolvePoint(
  sub: MachineDef,
  basePath: string,
  spec: string | undefined,
  which: 'entries' | 'exits',
  expanded: Set<string>,
): string | null {
  if (!spec) return null;
  const [stateId, name] = spec.split(':');
  const st = sub.states.find((s) => s.id === stateId);
  if (!st) return null;
  const p = join(basePath, stateId);
  if (name && st.uses && expanded.has(p)) {
    const inner = machines[st.uses];
    const deeper = inner && resolvePoint(inner, p, inner[which]?.[name], which, expanded);
    if (deeper) return deeper;
  }
  // a default entry into an expanded composite continues to its own default entry
  if (!name && which === 'entries' && st.uses && expanded.has(p)) {
    const inner = machines[st.uses];
    const deeper = inner && resolvePoint(inner, p, inner.entries?.default, 'entries', expanded);
    if (deeper) return deeper;
  }
  return p;
}

export interface Graph {
  nodes: Node<MapNodeData>[];
  edges: Edge<MapEdgeData>[];
}

export function buildGraph(rootId: string, expanded: Set<string>): Graph {
  const root = machines[rootId];
  const nodes: Node<MapNodeData>[] = [];
  const edges: Edge<MapEdgeData>[] = [];
  if (!root) return { nodes, edges };
  const layout = layoutMachine(root, '', expanded);
  const abs = new Map<string, Rect>();

  const pendingEdges: { l: Layout; origin: Pt }[] = [];
  function emit(l: Layout, origin: Pt, parentId?: string) {
    for (const lane of l.lanes)
      nodes.push({
        id: `lane:${l.prefix}:${lane.title}`,
        type: 'map',
        position: { x: lane.x, y: lane.y },
        parentId,
        selectable: false,
        draggable: false,
        width: 260,
        height: 24,
        measured: { width: 260, height: 24 },
        data: { variant: 'lane', label: lane.title, path: '', machineId: l.machine.id, openCount: 0, sideOnly: false, width: 260, height: 24 },
      });
    for (const it of l.items) {
      const id = `n:${it.path}`;
      const rect = { x: origin.x + it.x, y: origin.y + it.y, w: it.w, h: it.h };
      abs.set(it.path, rect);
      nodes.push({
        id,
        type: 'map',
        position: { x: it.x, y: it.y },
        parentId,
        draggable: false,
        // sizes are known from layout; giving them to React Flow means a node never waits to be measured
        width: it.w,
        height: it.h,
        measured: { width: it.w, height: it.h },
        style: { width: it.w, height: it.h },
        zIndex: it.variant === 'group' ? 0 : 1,
        data: {
          variant: it.variant,
          label: it.state.label,
          path: it.path,
          machineId: l.machine.id,
          state: it.state,
          sub: it.sub,
          openCount: it.sub ? openCount(it.sub.id) : 0,
          sideOnly:
            !l.machine.parallel &&
            it.state.kind !== 'initial' &&
            l.machine.transitions.length > 0 &&
            !l.machine.transitions.some((t) => t.flow !== 'side' && (t.from === it.state.id || t.to === it.state.id)),
          width: it.w,
          height: it.h,
        },
      });
      if (it.child) {
        const childOrigin = { x: rect.x + PAD, y: rect.y + HEADER };
        // children are positioned relative to the group node
        const shifted: Layout = {
          ...it.child,
          items: it.child.items.map((c) => ({ ...c, x: c.x + PAD, y: c.y + HEADER })),
          lanes: it.child.lanes.map((c) => ({ ...c, x: c.x + PAD, y: c.y + HEADER })),
        };
        emit(shifted, { x: rect.x, y: rect.y }, id);
        pendingEdges.push({ l: it.child, origin: childOrigin });
      }
    }
  }
  emit(layout, { x: 0, y: 0 });
  pendingEdges.unshift({ l: layout, origin: { x: 0, y: 0 } });

  for (const { l, origin } of pendingEdges) {
    const m = l.machine;
    for (const e of l.edges) {
      const tr = e.tr;
      let pts = e.points.map((p) => ({ x: p.x + origin.x, y: p.y + origin.y }));
      const label = { x: e.label.x + origin.x, y: e.label.y + origin.y };
      const fromSt = m.states.find((s) => s.id === tr.from)!;
      const toSt = m.states.find((s) => s.id === tr.to)!;
      let srcPath = join(l.prefix, tr.from);
      let dstPath = join(l.prefix, tr.to);

      if (fromSt.uses && expanded.has(srcPath) && tr.fromExit) {
        const sub = machines[fromSt.uses];
        const inner = sub && resolvePoint(sub, srcPath, sub.exits?.[tr.fromExit], 'exits', expanded);
        const r = inner && abs.get(inner);
        if (inner && r) {
          pts = [clip(r, pts[0]), ...pts];
          srcPath = inner;
        }
      }
      if (toSt.uses && expanded.has(dstPath)) {
        const sub = machines[toSt.uses];
        const inner = sub && resolvePoint(sub, dstPath, sub.entries?.[tr.toEntry ?? 'default'], 'entries', expanded);
        const r = inner && abs.get(inner);
        if (inner && r) {
          pts = [...pts, clip(r, pts[pts.length - 1])];
          dstPath = inner;
        }
      }
      const isOpen = !!tr.open;
      const isSignal = tr.kind === 'signal';
      const color = isOpen ? EDGE.open : isSignal ? EDGE.signal : EDGE.normal;
      edges.push({
        id: `e:${join(l.prefix, tr.id)}`,
        source: `n:${srcPath}`,
        target: `n:${dstPath}`,
        type: 'map',
        zIndex: 5,
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
        data: { points: pts, label, tr, machineId: m.id, selPath: join(l.prefix, tr.id), quiet: l.lanes.length > 0 },
      });
    }
  }
  return { nodes, edges };
}

/** What a selection path points at, walking down from the root machine. */
export interface Resolved {
  machine: MachineDef;
  state?: StateDef;
  transition?: TransitionDef;
  /** instance paths of the composites the element sits inside */
  ancestors: string[];
  /** titles of the composites it sits inside, for the panel */
  trail: { label: string; path: string }[];
}

export function resolveSelection(rootId: string, path: string): Resolved | null {
  let m = machines[rootId];
  if (!m || !path) return null;
  const segs = path.split('/');
  const ancestors: string[] = [];
  const trail: Resolved['trail'] = [];
  let prefix = '';
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const last = i === segs.length - 1;
    const st = m.states.find((s) => s.id === seg);
    if (st) {
      if (last) return { machine: m, state: st, ancestors, trail };
      const sub = st.uses ? machines[st.uses] : undefined;
      if (!sub) return null;
      prefix = join(prefix, seg);
      ancestors.push(prefix);
      trail.push({ label: st.label, path: prefix });
      m = sub;
      continue;
    }
    const tr = m.transitions.find((t) => t.id === seg);
    if (tr && last) return { machine: m, transition: tr, ancestors, trail };
    return null;
  }
  return null;
}
