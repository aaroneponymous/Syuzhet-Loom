import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { Background, BackgroundVariant, Controls, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ROOT_MACHINE, machineList, machines, modelMeta, openQuestions, scenarios } from '../model';
import type { StateDef, TransitionDef } from '../model/types';
import { buildGraph, resolveSelection } from './graph';
import { MapEdge, MapNode, EmphasisCtx, ViewCtx } from './flowParts';
import type { Emphasis } from './flowParts';
import { Panel } from './Panel';
import { HelpModal, OpenPointsDrawer } from './Drawers';
import { ScenarioList, ScenarioPlayer } from './Scenarios';
import { CANVAS_DOTS, applyTheme, readTheme, type ThemeChoice } from './theme';
import brandMarkLight from './assets/brand/syuzhet-loom-mark-light.svg';
import brandMarkDark from './assets/brand/syuzhet-loom-mark-dark.svg';
import { ResponsesDrawer, ResponsesProvider, useResponses } from './responses';

const nodeTypes = { map: MapNode };
const edgeTypes = { map: MapEdge };

// --- hash routing: #/<machine>[/<selection path>]?via=a,b&q=Q-02 -----------------
interface Route {
  root: string;
  sel: string | null;
  via: string[];
  q: string | null;
}
function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [pathPart, query = ''] = raw.split('?');
  const segs = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  const params = new URLSearchParams(query);
  const root = segs[0] && machines[segs[0]] ? segs[0] : ROOT_MACHINE;
  const sel = segs.length > 1 ? segs.slice(1).join('/') : null;
  const via = (params.get('via') ?? '').split(',').filter((v) => machines[v]);
  return { root, sel, via, q: params.get('q') };
}
function toHash(r: Route): string {
  const params = new URLSearchParams();
  const via = r.via.filter((v) => v !== ROOT_MACHINE && v !== r.root);
  if (via.length) params.set('via', via.join(','));
  if (r.q) params.set('q', r.q);
  const qs = params.toString().replace(/%2C/g, ',');
  return `#/${r.root}${r.sel ? '/' + r.sel : ''}${qs ? '?' + qs : ''}`;
}

// --- search index -----------------------------------------------------------------
interface Hit {
  type: 'machine' | 'state' | 'transition' | 'question';
  machineId?: string;
  elementId?: string;
  questionId?: string;
  title: string;
  context: string;
  hay: string;
  refs: string[];
}
const searchIndex: Hit[] = (() => {
  const hits: Hit[] = [];
  for (const m of machineList) {
    hits.push({ type: 'machine', machineId: m.id, title: m.title, context: m.kind === 'boundary' ? 'Journey not yet written' : 'Component', hay: `${m.title} ${m.summary} ${m.description ?? ''}`.toLowerCase(), refs: m.refs ?? [] });
    for (const s of m.states) {
      if (s.kind === 'initial') continue;
      hits.push({
        type: 'state',
        machineId: m.id,
        elementId: s.id,
        title: s.label,
        context: `${m.title} · state`,
        hay: `${s.label} ${s.description ?? ''} ${(s.rules ?? []).join(' ')} ${s.open?.note ?? ''}`.toLowerCase(),
        refs: [...(s.refs ?? []), ...(s.open?.questions ?? [])],
      });
    }
    for (const t of m.transitions)
      hits.push({
        type: 'transition',
        machineId: m.id,
        elementId: t.id,
        title: t.event,
        context: `${m.title} · ${t.kind === 'signal' ? 'signal' : 'transition'}`,
        hay: `${t.event} ${t.description ?? ''} ${t.guard ?? ''} ${(t.effects ?? []).join(' ')} ${t.open?.note ?? ''}`.toLowerCase(),
        refs: [...(t.refs ?? []), ...(t.open?.questions ?? [])],
      });
  }
  for (const q of openQuestions)
    hits.push({ type: 'question', questionId: q.id, title: `${q.id} ${q.title}`, context: 'Open point', hay: `${q.id} ${q.title} ${q.question}`.toLowerCase(), refs: [q.id] });
  return hits;
})();

function search(query: string): Hit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const idQuery = /^(d|p|df|s|q|pn|rp|af|ev|c|ac)-?[a-z0-9-]*\d$/i.test(q) ? q.toUpperCase() : null;
  const scored: [number, Hit][] = [];
  for (const h of searchIndex) {
    let score = 0;
    if (idQuery && h.refs.includes(idQuery)) score = h.type === 'question' ? 120 : 90;
    const title = h.title.toLowerCase();
    if (title === q) score = Math.max(score, 100);
    else if (title.startsWith(q)) score = Math.max(score, 80);
    else if (title.includes(q)) score = Math.max(score, 60);
    else if (h.hay.includes(q)) score = Math.max(score, 30);
    if (score) scored.push([score + (h.type === 'machine' ? 5 : 0), h]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, 60).map((x) => x[1]);
}

function allCompositePaths(rootId: string, maxDepth: number): string[] {
  const out: string[] = [];
  const walk = (mid: string, prefix: string, depth: number, stack: string[]) => {
    if (depth >= maxDepth) return;
    const m = machines[mid];
    for (const s of m.states) {
      const sub = s.uses ? machines[s.uses] : undefined;
      if (!sub || sub.kind === 'boundary' || stack.includes(sub.id)) continue;
      const p = prefix ? `${prefix}/${s.id}` : s.id;
      out.push(p);
      walk(sub.id, p, depth + 1, [...stack, mid]);
    }
  };
  walk(rootId, '', 0, []);
  return out;
}

export type PathMode = 'main' | 'all';

const THEME_LABEL: Record<ThemeChoice, string> = { system: 'Auto', light: 'Light', dark: 'Dark' };
const THEME_ICON: Record<ThemeChoice, string> = { system: '◐', light: '☀', dark: '☾' };

/** A lens keeps the elements that answer one question and fades the rest. */
export type Lens = { type: 'none' } | { type: 'open' } | { type: 'changed' } | { type: 'responses' } | { type: 'unstated' } | { type: 'ref'; ref: string };
// the ids the model's metadata names as changed (src/model/meta.ts); with none, the lens is not offered
const CHANGED = new Set<string>(modelMeta.changed?.refs ?? []);
type Pred = (machineId: string, el: StateDef | TransitionDef) => boolean;
function lensPredicate(lens: Lens, counts: Map<string, number>): Pred | null {
  switch (lens.type) {
    case 'changed':
      return (_m, el) => (el.refs ?? []).some((r) => CHANGED.has(r));
    case 'responses':
      return (m, el) => (counts.get(`e:${m}/${el.id}`) ?? 0) > 0;
    case 'unstated':
      return (_m, el) => 'event' in el && el.actor === 'unstated';
    case 'ref': {
      const ref = lens.ref.trim().toUpperCase();
      return ref ? (_m, el) => (el.refs ?? []).includes(ref) : null;
    }
    default:
      return null;
  }
}
/** Does anything inside a machine (or the machines it uses) match? */
function machineMatches(id: string, pred: Pred, memo: Map<string, boolean>, stack: string[] = []): boolean {
  if (memo.has(id)) return memo.get(id)!;
  if (stack.includes(id)) return false;
  const m = machines[id];
  if (!m) return false;
  const hit =
    m.states.some((s) => pred(id, s) || (s.uses ? machineMatches(s.uses, pred, memo, [...stack, id]) : false)) || m.transitions.some((t) => pred(id, t));
  memo.set(id, hit);
  return hit;
}

function Canvas({
  rootId,
  expanded,
  fitKey,
  selected,
  pathMode,
  openOnly,
  lens,
  anchor,
  onClear,
}: {
  rootId: string;
  expanded: Set<string>;
  fitKey: string;
  selected: string | null;
  pathMode: PathMode;
  openOnly: boolean;
  lens: Lens;
  anchor: { path: string; n: number } | null;
  onClear: () => void;
}) {
  const { fitView, getViewport, setViewport } = useReactFlow();
  const { counts } = useResponses();
  const graph = useMemo(() => buildGraph(rootId, expanded), [rootId, expanded]);
  // Where every node sits on the canvas, so the view can stay put when one component opens or closes.
  const abs = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const n of graph.nodes) {
      const p = n.parentId ? m.get(n.parentId) : undefined;
      m.set(n.id, { x: (p?.x ?? 0) + n.position.x, y: (p?.y ?? 0) + n.position.y });
    }
    return m;
  }, [graph]);
  const prevAbs = useRef(abs);
  const lastAnchor = useRef(0);
  const lastFit = useRef('');
  useEffect(() => {
    const before = prevAbs.current;
    prevAbs.current = abs;
    const id = anchor ? `n:${anchor.path}` : '';
    if (anchor && anchor.n !== lastAnchor.current && before.has(id) && abs.has(id)) {
      // one component was opened or closed: keep it where it was on screen
      lastAnchor.current = anchor.n;
      lastFit.current = fitKey;
      const vp = getViewport();
      const a = before.get(id)!;
      const b = abs.get(id)!;
      setViewport({ x: vp.x + (a.x - b.x) * vp.zoom, y: vp.y + (a.y - b.y) * vp.zoom, zoom: vp.zoom }, { duration: 180 });
      return;
    }
    if (fitKey === lastFit.current) return;
    lastFit.current = fitKey;
    const t = window.setTimeout(() => fitView({ padding: 0.12, duration: 250, maxZoom: 1.25 }), 60);
    return () => window.clearTimeout(t);
  }, [abs, anchor, fitKey, fitView, getViewport, setViewport]);
  // the Fit button asks directly, so it works however the viewport was last moved
  useEffect(() => {
    const onFit = () => fitView({ padding: 0.12, duration: 250, maxZoom: 1.25 });
    window.addEventListener('loom-fit', onFit);
    return () => window.removeEventListener('loom-fit', onFit);
  }, [fitView]);

  // How strongly each element is drawn: the selection and its neighbours stand out; otherwise the
  // chosen view (main path, undecided only) decides. Nothing is removed from the map.
  const emphasis = useMemo(() => {
    const level = new Map<string, Emphasis>();
    const pred = lensPredicate(lens, counts);
    const nodeIds = new Set(graph.nodes.map((n) => n.id));
    const selNode = selected ? `n:${selected}` : null;
    const selEdge = selected ? `e:${selected}` : null;
    const selIsNode = !!selNode && nodeIds.has(selNode);
    const selIsEdge = !!selEdge && graph.edges.some((e) => e.id === selEdge);
    const within = (id: string, root: string) => id === root || id.startsWith(root + '/');

    if (selIsNode || selIsEdge) {
      const keepNodes = new Set<string>();
      const keepEdges = new Set<string>();
      if (selIsNode) {
        for (const n of graph.nodes) if (within(n.id, selNode!)) keepNodes.add(n.id);
        for (const e of graph.edges)
          if (within(e.source, selNode!) || within(e.target, selNode!)) {
            keepEdges.add(e.id);
            keepNodes.add(e.source);
            keepNodes.add(e.target);
          }
      } else {
        const e = graph.edges.find((x) => x.id === selEdge)!;
        keepEdges.add(e.id);
        keepNodes.add(e.source);
        keepNodes.add(e.target);
      }
      // the boxes that contain a kept element stay readable too
      for (const id of [...keepNodes]) {
        const parts = id.slice(2).split('/');
        for (let i = 1; i < parts.length; i++) keepNodes.add('n:' + parts.slice(0, i).join('/'));
      }
      for (const n of graph.nodes) if (n.data.variant !== 'lane' && !keepNodes.has(n.id)) level.set(n.id, 'dim');
      for (const e of graph.edges) if (!keepEdges.has(e.id)) level.set(e.id, 'dim');
    } else if (pred) {
      const memo = new Map<string, boolean>();
      for (const n of graph.nodes) {
        const d = n.data;
        if (d.variant === 'lane' || d.variant === 'group' || !d.state) continue;
        const hit = pred(d.machineId, d.state) || (d.sub ? machineMatches(d.sub.id, pred, memo) : false);
        if (!hit) level.set(n.id, 'dim');
      }
      for (const e of graph.edges) if (!e.data || !pred(e.data.machineId, e.data.tr)) level.set(e.id, 'dim');
    } else if (openOnly) {
      for (const n of graph.nodes) {
        const d = n.data;
        if (d.variant === 'lane' || d.variant === 'group') continue;
        if (!d.state?.open && d.openCount === 0) level.set(n.id, 'dim');
      }
      for (const e of graph.edges) if (!e.data?.tr.open) level.set(e.id, 'dim');
    } else if (pathMode === 'main') {
      for (const n of graph.nodes) if (n.data.sideOnly && !n.data.state?.open && n.data.variant !== 'group') level.set(n.id, 'side');
      for (const e of graph.edges) if (e.data?.tr.flow === 'side' && !e.data.tr.open) level.set(e.id, 'side');
    }
    return (id: string): Emphasis => level.get(id) ?? 'normal';
  }, [graph, selected, pathMode, openOnly, lens, counts]);

  return (
    <EmphasisCtx.Provider value={emphasis}>
    <ReactFlow
      onPaneClick={onClear}
      nodes={graph.nodes}
      edges={graph.edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      minZoom={0.08}
      maxZoom={2.5}
      proOptions={{ hideAttribution: true }}
      fitView
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color={CANVAS_DOTS} />
      {/* zoom only: "Fit" in the toolbar fits the view */}
      <Controls showInteractive={false} showFitView={false} position="bottom-left" />
    </ReactFlow>
    </EmphasisCtx.Provider>
  );
}

export function App() {
  return (
    <ResponsesProvider>
      <AppInner />
    </ResponsesProvider>
  );
}

const PANEL_KEY = 'syuzhet-loom-panel-width';
const PANEL_DEFAULT = 400;
const PANEL_MIN = 300;
const panelMax = () => Math.max(PANEL_MIN, Math.min(900, Math.round(window.innerWidth * 0.7)));
const clampPanel = (w: number) => Math.max(PANEL_MIN, Math.min(panelMax(), Math.round(w)));

/** Width of the details panel: draggable, remembered in this browser, and kept within the window. */
function usePanelWidth() {
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(PANEL_KEY));
      return saved ? clampPanel(saved) : PANEL_DEFAULT;
    } catch {
      return PANEL_DEFAULT;
    }
  });
  const [dragging, setDragging] = useState(false);
  const apply = useCallback((w: number) => {
    const next = clampPanel(w);
    setWidth(next);
    try {
      localStorage.setItem(PANEL_KEY, String(next));
    } catch {
      /* storage unavailable: the width still applies for this visit */
    }
  }, []);
  // a narrower window must not leave the panel wider than it allows
  useEffect(() => {
    const onResize = () => setWidth((w) => clampPanel(w));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      setDragging(true);
      const move = (ev: PointerEvent) => apply(window.innerWidth - ev.clientX);
      const stop = () => {
        setDragging(false);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', stop);
        window.dispatchEvent(new Event('loom-fit'));
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', stop);
    },
    [apply],
  );
  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 80 : 20;
      if (e.key === 'ArrowLeft') apply(width + step);
      else if (e.key === 'ArrowRight') apply(width - step);
      else if (e.key === 'Home') apply(PANEL_DEFAULT);
      else return;
      e.preventDefault();
    },
    [apply, width],
  );
  return { width, dragging, startDrag, onKey, reset: () => apply(PANEL_DEFAULT) };
}

function AppInner() {
  const panel = usePanelWidth();
  const [pathMode, setPathModeState] = useState<PathMode>(() => {
    try {
      return localStorage.getItem('syuzhet-loom-path-mode') === 'all' ? 'all' : 'main';
    } catch {
      return 'main';
    }
  });
  const setPathMode = (m: PathMode) => {
    setPathModeState(m);
    try {
      localStorage.setItem('syuzhet-loom-path-mode', m);
    } catch {
      /* ignore */
    }
  };
  const gotoRef = useRef<(machineId: string, elementId?: string) => void>(() => {});
  const [lens, setLens] = useState<Lens>({ type: 'none' });
  const openOnly = lens.type === 'open';
  const [anchor, setAnchor] = useState<{ path: string; n: number } | null>(null);
  const [play, setPlay] = useState<{ id: string; step: number } | null>(null);
  const [showScenarios, setShowScenarios] = useState(false);
  const responses = useResponses();
  const [showResponses, setShowResponses] = useState(false);
  const [route, setRoute] = useState<Route>(parseHash);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [showOpen, setShowOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  const nextTheme = () => {
    const next: ThemeChoice = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
    applyTheme(next);
    setTheme(next);
  };
  const [fitNonce, setFitNonce] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  // keep the URL and the state in step
  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = useCallback((r: Route) => {
    const h = toHash(r);
    if (window.location.hash !== h) window.location.hash = h;
    setRoute(r);
  }, []);

  const resolved = useMemo(() => (route.sel ? resolveSelection(route.root, route.sel) : null), [route.root, route.sel]);

  // a new root starts collapsed; a selection inside nested components opens its ancestors
  const lastRoot = useRef<string | null>(null);
  useEffect(() => {
    setExpanded((prev) => {
      const next = lastRoot.current === route.root ? new Set(prev) : new Set<string>();
      lastRoot.current = route.root;
      for (const a of resolved?.ancestors ?? []) next.add(a);
      return next.size === prev.size && [...next].every((x) => prev.has(x)) ? prev : next;
    });
  }, [route.root, resolved]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setShowOpen(false);
        setShowHelp(false);
        setShowScenarios(false);
        setShowResponses(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const select = useCallback((path: string) => go({ ...route, sel: path, q: null }), [go, route]);
  const toggle = useCallback(
    (path: string) => {
      // Two levels open in place stay readable; anything deeper gets the whole canvas instead.
      if (!expanded.has(path) && path.split('/').length >= 3) {
        const target = resolveSelection(route.root, path)?.state?.uses;
        if (target) return gotoRef.current(target);
      }
      setAnchor((a) => ({ path, n: (a?.n ?? 0) + 1 }));
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          for (const p of [...next]) if (p === path || p.startsWith(path + '/')) next.delete(p);
        } else next.add(path);
        return next;
      });
    },
    [expanded, route.root],
  );
  const goto = useCallback(
    (machineId: string, elementId?: string) => {
      let via = route.via;
      if (machineId === ROOT_MACHINE) via = [];
      else if (machineId !== route.root) {
        const at = via.indexOf(machineId);
        via = at >= 0 ? via.slice(0, at) : [...via, route.root];
      }
      go({ root: machineId, sel: elementId ?? null, via, q: null });
    },
    [go, route],
  );
  gotoRef.current = goto;
  const crumbTo = (index: number, trail: string[]) => go({ root: trail[index], sel: null, via: trail.slice(0, index), q: null });

  const trail = useMemo(() => {
    const t = [...route.via.filter((v) => v !== route.root), route.root];
    if (t[0] !== ROOT_MACHINE) t.unshift(ROOT_MACHINE);
    return t;
  }, [route.via, route.root]);
  // the root crumb says where you are
  const crumbTitle = (id: string) => (id === ROOT_MACHINE ? 'Overview' : machines[id].title);

  const hits = useMemo(() => search(query), [query]);
  const expandedKey = useMemo(() => [...expanded].sort().join('|'), [expanded]);
  const ctx = useMemo(
    () => ({ selected: route.q ? null : route.sel, expanded, select, toggle, focus: (id: string) => goto(id), clear: () => go({ ...route, sel: null, q: null }) }),
    [route, expanded, select, toggle, goto, go],
  );
  const root = machines[route.root];
  const newResponses = responses.entries.filter((e) => !e.reviewed).length;
  const unresolved = openQuestions.filter((q) => q.status === 'unresolved' || q.status === 'discrepancy' || q.status === 'ambiguity');

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img className="brand-mark brand-mark-light" src={brandMarkLight} alt="" />
          <img className="brand-mark brand-mark-dark" src={brandMarkDark} alt="" />
          <span className="brand-name" title={modelMeta.title}>
            <span className="brand-accent">Syuzhet Loom</span>
          </span>
        </div>
        <div className="search">
          <input
            ref={searchRef}
            data-testid="search"
            placeholder={`Search the map, or an id such as ${modelMeta.exampleIds.slice(0, 2).join(' or ')}`}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
          />
          {searchOpen && query.trim().length >= 2 && (
            <div className="search-results" data-testid="search-results">
              {hits.length === 0 && <div className="search-empty">Nothing found for “{query}”.</div>}
              {hits.map((h, i) => (
                <button
                  key={i}
                  className="hit"
                  onClick={() => {
                    setSearchOpen(false);
                    setQuery('');
                    if (h.type === 'question') go({ ...route, q: h.questionId!, sel: null });
                    else goto(h.machineId!, h.elementId);
                  }}
                >
                  <span className={`hit-type t-${h.type}`}>{h.type}</span>
                  <span className="hit-title">{h.title}</span>
                  <span className="hit-context">{h.context}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {scenarios.length > 0 && (
          <button className="top-btn" data-testid="scenarios-button" onClick={() => setShowScenarios(true)} title="Walk through a worked example on the map">
            Scenarios
          </button>
        )}
        <button className="top-btn" data-testid="open-points" onClick={() => setShowOpen(true)} title="Everything that is not decided" aria-label={`${unresolved.length} open points`}>
          <span className="badge-open">OPEN</span> {unresolved.length}
        </button>
        <button className="top-btn" data-testid="responses-button" onClick={() => setShowResponses(true)} title="Everything you have logged for review">
          Responses
          {newResponses > 0 && <span className="resp-dot">{newResponses}</span>}
        </button>
        <button className="top-btn" data-testid="help-button" onClick={() => setShowHelp(true)} title="How to read the map, and its sources">
          Help
        </button>
        <button className="top-btn theme-btn" data-testid="theme-toggle" onClick={nextTheme} title="Theme: follows the system, light or dark. Click to change." aria-label={`Theme: ${THEME_LABEL[theme]}`}>
          <span aria-hidden="true">{THEME_ICON[theme]}</span> {THEME_LABEL[theme]}
        </button>
      </header>

      <div className="subbar">
        <div className="history">
          <button className="btn-quiet" onClick={() => window.history.back()} title="Back" aria-label="Back">
            ←
          </button>
          <button className="btn-quiet" onClick={() => window.history.forward()} title="Forward" aria-label="Forward">
            →
          </button>
        </div>
        <nav className="crumbs" aria-label="Breadcrumbs" data-testid="crumbs">
          {trail.map((id, i) => (
            <span key={id + i}>
              {i > 0 && <span className="crumb-sep">›</span>}
              {i === trail.length - 1 ? (
                <span className="crumb current">{crumbTitle(id)}</span>
              ) : (
                <button className="crumb" onClick={() => crumbTo(i, trail)}>
                  {crumbTitle(id)}
                </button>
              )}
            </span>
          ))}
        </nav>
        <div className="subbar-actions">
          <div className="segmented" role="group" aria-label="Which paths to emphasise">
            <button className={pathMode === 'main' ? 'on' : ''} data-testid="mode-main" onClick={() => setPathMode('main')} title="Emphasise the ordinary flow; other paths stay visible but faint">
              Main path
            </button>
            <button className={pathMode === 'all' ? 'on' : ''} data-testid="mode-all" onClick={() => setPathMode('all')} title="Draw every path with equal weight">
              All paths
            </button>
          </div>
          <label className="lens">
            <span>Highlight</span>
            <select
              data-testid="lens"
              value={lens.type}
              onChange={(e) => {
                const v = e.target.value as Lens['type'];
                setLens(v === 'ref' ? { type: 'ref', ref: '' } : ({ type: v } as Lens));
              }}
            >
              <option value="none">None</option>
              <option value="open">Undecided</option>
              {CHANGED.size > 0 && <option value="changed">{modelMeta.changed!.label}</option>}
              <option value="responses">Has a response</option>
              <option value="unstated">Cause not stated</option>
              <option value="ref">A decision or criterion…</option>
            </select>
            {lens.type === 'ref' && (
              <input data-testid="lens-ref" autoFocus placeholder={modelMeta.exampleIds[0]} value={lens.ref} onChange={(e) => setLens({ type: 'ref', ref: e.target.value })} aria-label="Decision or criterion id" />
            )}
          </label>
          <span className="subbar-sep" />
          {route.root !== ROOT_MACHINE && (
            <>
              <button className="btn-quiet" onClick={() => setExpanded(new Set(allCompositePaths(route.root, 2)))} title="Open every component in this view">
                Expand all
              </button>
              <button className="btn-quiet" onClick={() => setExpanded(new Set())} title="Close every component in this view">
                Collapse all
              </button>
            </>
          )}
          <button className="btn-quiet" data-testid="fit" onClick={() => window.dispatchEvent(new Event('loom-fit'))} title="Show the whole view">
            Fit
          </button>
        </div>
      </div>

      <div className={`main ${panel.dragging ? 'is-resizing' : ''}`} style={{ '--panel-w': `${panel.width}px` } as React.CSSProperties} onClick={() => setSearchOpen(false)}>
        <div className="canvas" data-testid="canvas">
          <ViewCtx.Provider value={ctx}>
            {/* a fresh canvas per machine, so measurements from the previous view cannot leak into this one */}
            <ReactFlowProvider key={route.root}>
              <Canvas
                rootId={route.root}
                expanded={expanded}
                fitKey={`${route.root}#${expandedKey}#${fitNonce}`}
                selected={route.q ? null : route.sel}
                pathMode={pathMode}
                openOnly={openOnly}
                lens={lens}
                anchor={anchor}
                onClear={() => (route.sel || route.q) && go({ ...route, sel: null, q: null })}
              />
            </ReactFlowProvider>
          </ViewCtx.Provider>
          {play && (
            <ScenarioPlayer
              play={play}
              onStep={(step) => {
                const sc = scenarios.find((x) => x.id === play.id)!;
                setPlay({ id: play.id, step });
                go({ root: sc.steps[step].machine, sel: sc.steps[step].element, via: [], q: null });
              }}
              onQuestion={(id) => go({ ...route, q: id, sel: null })}
              onClose={() => setPlay(null)}
            />
          )}
          {root.kind === 'boundary' && <div className="canvas-note">This journey is not written yet, so nothing is drawn inside it.</div>}
        </div>
        <div
          className="panel-resizer"
          data-testid="panel-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the details panel"
          aria-valuenow={panel.width}
          aria-valuemin={PANEL_MIN}
          aria-valuemax={panelMax()}
          tabIndex={0}
          title="Drag to resize. Double-click to reset."
          onPointerDown={panel.startDrag}
          onDoubleClick={panel.reset}
          onKeyDown={panel.onKey}
        />
        <Panel
          rootId={route.root}
          resolved={resolved}
          selPath={route.sel}
          questionId={route.q}
          onQuestion={(id) => go({ ...route, q: id, sel: id ? null : route.sel })}
          onGoto={goto}
          onClose={() => go({ ...route, sel: null, q: null })}
        />
      </div>

      {showResponses && (
        <ResponsesDrawer
          onClose={() => setShowResponses(false)}
          onOpenLink={(hash) => {
            window.location.hash = hash;
          }}
        />
      )}
      {showScenarios && (
        <ScenarioList
          onClose={() => setShowScenarios(false)}
          onPick={(id) => {
            setShowScenarios(false);
            setPlay({ id, step: 0 });
            const st = scenarios.find((x) => x.id === id)!.steps[0];
            go({ root: st.machine, sel: st.element, via: [], q: null });
          }}
        />
      )}
      {showOpen && <OpenPointsDrawer onClose={() => setShowOpen(false)} onPick={(id) => go({ ...route, q: id, sel: null })} />}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}
