import type { MachineDef } from './types';
import { overviewMachines } from './machines/overview';
import { bookingMachines } from './machines/booking';
import { manageMachines } from './machines/manage';

export { openQuestions, nonVisualRules } from './questions';
export * from './types';
export { scenarios } from './scenarios';
export type { Scenario, ScenarioStep } from './scenarios';
export { modelMeta } from './meta';
export type { ModelMeta } from './meta';

export const machineList: MachineDef[] = [...overviewMachines, ...bookingMachines, ...manageMachines];

export const machines: Record<string, MachineDef> = Object.fromEntries(machineList.map((m) => [m.id, m]));

/** The id of the overview machine every other machine hangs from. */
export const ROOT_MACHINE = 'overview';
