// Parsing trace references. Shared by the viewer and the validator; no file or network access here.
import { loomConfig } from '../../loom.config';
import type { Layer, TraceRef } from './types';

export type ParsedRef =
  | { scheme: 'spec'; id: string }
  | { scheme: 'model'; machine: string; element?: string }
  | { scheme: 'handoff'; slice: string; version: string; id: string }
  | { scheme: 'design-map'; slice: string; version: string; id: string }
  | { scheme: 'figma'; fileKey: string; node: string }
  | { scheme: 'code'; repo: string; sha: string; path: string; from: number; to: number }
  | { scheme: 'test'; repo: string; sha: string; path: string; name: string }
  | { scheme: 'notion'; page: string }
  | { scheme: 'model-scenario'; id: string }
  | { scheme: 'finding'; id: string }
  | { scheme: 'work'; id: string };

// The id families of the source documents (see MODELING.md): decisions D-, acceptance criteria AC-Jnn-,
// parameters PN-, release priorities RP-, architecture and evaluation follow-ups AF- and EV-, deferred DF-,
// superseded S-, principles P-, open questions Q- and C-; and a journey document itself, Jnn.
const SPEC_ID = /^(D|AC-J\d\d|PN|RP|AF|EV|DF|S|P|Q|C)-\d+$|^J\d\d$/;
const VERSIONED = /^(handoff|design-map):([a-z0-9-]+)\/(v\d+)#([A-Z]+-\d+)$/;
const CODE = /^code:([\w.-]+)@([0-9a-f]{7,40}):([^#]+)#L(\d+)-L(\d+)$/;
const TEST = /^test:([\w.-]+)@([0-9a-f]{7,40}):([^:]+)::([\w]+)$/;

/** Parses a reference, or returns null when it has no recognised form. */
export function parseRef(ref: TraceRef): ParsedRef | null {
  if (SPEC_ID.test(ref)) return { scheme: 'spec', id: ref };
  let m: RegExpMatchArray | null;
  if ((m = ref.match(/^model:([a-z0-9-]+)(?:\/([a-z0-9_-]+))?$/))) return { scheme: 'model', machine: m[1], element: m[2] };
  if ((m = ref.match(VERSIONED))) return { scheme: m[1] as 'handoff' | 'design-map', slice: m[2], version: m[3], id: m[4] };
  if ((m = ref.match(/^figma:([A-Za-z0-9]+)\/(\d+-\d+)$/))) return { scheme: 'figma', fileKey: m[1], node: m[2] };
  if ((m = ref.match(CODE))) {
    const from = Number(m[4]);
    const to = Number(m[5]);
    return from >= 1 && to >= from ? { scheme: 'code', repo: m[1], sha: m[2], path: m[3], from, to } : null;
  }
  if ((m = ref.match(TEST))) return { scheme: 'test', repo: m[1], sha: m[2], path: m[3], name: m[4] };
  if ((m = ref.match(/^notion:([0-9a-f]{32})$/))) return { scheme: 'notion', page: m[1] };
  if ((m = ref.match(/^model-scenario:(S\d{2})$/))) return { scheme: 'model-scenario', id: m[1] };
  if ((m = ref.match(/^finding:(XLF-\d{2,})$/))) return { scheme: 'finding', id: m[1] };
  if ((m = ref.match(/^work:(WI-\d{2,})$/))) return { scheme: 'work', id: m[1] };
  return null;
}

/** The layer a reference belongs to. */
export function layerOf(ref: TraceRef): Layer | null {
  const p = parseRef(ref);
  if (!p) return null;
  switch (p.scheme) {
    case 'spec':
      return /^(AF|EV)-/.test(p.id) ? 'architecture' : 'product';
    case 'notion':
      return 'product';
    case 'model':
      return 'model';
    case 'model-scenario':
      return 'verification';
    case 'handoff':
      return /^SCN-/.test(p.id) ? 'verification' : 'handoff';
    case 'design-map':
    case 'figma':
      return 'design';
    case 'code':
      return 'implementation';
    case 'test':
      return 'verification';
    case 'finding':
    case 'work':
      return 'work';
  }
}

/** A short label for display: the id part of the reference. */
export function shortLabel(ref: TraceRef): string {
  const p = parseRef(ref);
  if (!p) return ref;
  switch (p.scheme) {
    case 'spec':
    case 'finding':
    case 'work':
    case 'model-scenario':
      return p.id;
    case 'model':
      return p.element ? `${p.machine}/${p.element}` : p.machine;
    case 'handoff':
      return `${p.id} (${p.version})`;
    case 'design-map':
      return `map ${p.id} (${p.version})`;
    case 'figma':
      return `frame ${p.node}`;
    case 'code':
      return `${p.repo}@${p.sha.slice(0, 7)} ${p.path.split('/').pop()}:${p.from}-${p.to}`;
    case 'test':
      return `${p.repo}@${p.sha.slice(0, 7)} ${p.name}`;
    case 'notion':
      return `Notion ${p.page.slice(0, 8)}…`;
  }
}

/** Where a reference can be opened from the viewer, if anywhere. Versioned refs stay pinned. */
export function hrefOf(ref: TraceRef): string | null {
  const p = parseRef(ref);
  if (!p) return null;
  if (p.scheme === 'model') return `#/${p.machine}${p.element ? '/' + p.element : ''}`;
  if (p.scheme === 'model-scenario') return null;
  if (p.scheme === 'figma') return `https://www.figma.com/design/${p.fileKey}/?node-id=${p.node}`;
  if (p.scheme === 'notion') return `https://app.notion.com/p/${p.page}`;
  return null;
}

/** The file a versioned handoff or design-map reference points into, relative to the workspace root. */
export function pinnedPath(ref: TraceRef): string | null {
  const p = parseRef(ref);
  if (!p) return null;
  if (p.scheme === 'handoff') return `${loomConfig.handoffsDir}/${p.slice}/${p.version}/`;
  if (p.scheme === 'design-map') return `${loomConfig.handoffsDir}/${p.slice}/design/${p.version}/DESIGN_MAP.md`;
  return null;
}
