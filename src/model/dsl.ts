import type { MachineDef, StateDef, TransitionDef } from './types';

type StateExtra = Omit<StateDef, 'id' | 'label'>;
type TransitionExtra = Omit<TransitionDef, 'id' | 'from' | 'to' | 'event'> & { id?: string };

/** A state. */
export const s = (id: string, label: string, extra: StateExtra = {}): StateDef => ({ id, label, ...extra });

/** The initial pseudo-state. */
export const initial = (id = 'start'): StateDef => ({ id, label: 'Start', kind: 'initial' });

/** A final state. */
export const final = (id: string, label: string, extra: StateExtra = {}): StateDef => ({
  id,
  label,
  kind: 'final',
  ...extra,
});

/** A transition. Its id is derived from its endpoints unless given. */
export const t = (from: string, to: string, event: string, extra: TransitionExtra = {}): Omit<TransitionDef, 'id'> & { id?: string } => ({
  from,
  to,
  event,
  ...extra,
});

/** A signal between concurrent regions or components. */
export const signal = (from: string, to: string, event: string, extra: TransitionExtra = {}) =>
  t(from, to, event, { ...extra, kind: 'signal' });

type MachineInput = Omit<MachineDef, 'transitions'> & {
  transitions: (Omit<TransitionDef, 'id'> & { id?: string })[];
};

/** Builds a machine, giving every transition a stable id: `from__to`, then `from__to_2`, ... */
export function machine(def: MachineInput): MachineDef {
  const seen = new Map<string, number>();
  const transitions = def.transitions.map((tr) => {
    if (tr.id) return tr as TransitionDef;
    const base = `${tr.from}__${tr.to}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...tr, id: n === 1 ? base : `${base}_${n}` } as TransitionDef;
  });
  return { ...def, transitions };
}
