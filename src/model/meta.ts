// What the viewer says about this model: its name, what it covers and which source versions it represents.
// Change this file when you replace the bundled example with your own model.
import type { RefId } from './types';

export interface ModelMeta {
  /** Name of the model, shown in Help and in the coverage report. */
  title: string;
  /** One or two sentences on what the map covers. */
  description: string;
  /** Which versions of the source documents the model represents, in a sentence. */
  sourceNote: string;
  /** Two or three real ids, used as examples in search hints. The first should be a decision. */
  exampleIds: RefId[];
  /** Ids added or changed since an earlier version of the sources: drives the "changed" highlight. Omit to hide it. */
  changed?: { label: string; refs: RefId[] };
}

export const modelMeta: ModelMeta = {
  title: 'Meeting-room booking (example)',
  description:
    'An example model: how a person in an office books a meeting room, changes or cancels the booking, and what happens to the room on the day. It covers journeys J01 and J02, the components they share and the booking record.',
  sourceNote: 'The example specification in workspace/spec at version 2: decisions D-01 to D-22, journeys J01 and J02.',
  exampleIds: ['D-12', 'AC-J01-08', 'Q-01'],
  changed: { label: 'Changed since spec version 1', refs: ['D-21', 'D-22', 'AC-J01-14', 'AC-J02-04'] },
};
