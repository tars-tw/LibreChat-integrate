import { createStorageAtom } from '~/store/jotai-utils';

const DEFAULT_SHOW_RECALL = false;

/**
 * Whether a reply shows which memories it could refer to. Off until the user opts in, to keep
 * replies uncluttered. Display only: the memories still reach the model, and turning this on
 * shows the line on earlier replies too.
 */
export const showTarsMemoryRecallAtom = createStorageAtom<boolean>(
  'showTarsMemoryRecall',
  DEFAULT_SHOW_RECALL,
);
