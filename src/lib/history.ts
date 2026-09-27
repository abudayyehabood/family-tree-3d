import type { TreeNode } from '../model'

/** How many past trees to keep. Entries share structure, so the real cost is far below the count. */
const HISTORY_LIMIT = 60

export interface HistoryState {
  root: TreeNode
  past: TreeNode[]
  future: TreeNode[]
}

export type HistoryAction =
  /** A change to the family itself: undoable. */
  | { type: 'commit'; update: (current: TreeNode) => TreeNode }
  /** Collapsing or expanding a branch. Stored on the node, but it is a way of looking at the tree,
   *  not a change to it — keeping it out means undo never spends itself rewinding folds. */
  | { type: 'view'; update: (current: TreeNode) => TreeNode }
  | { type: 'undo' }
  | { type: 'redo' }

/**
 * Every tree operation rebuilds bottom-up and returns untouched branches unchanged, so each entry
 * here is one root reference sharing almost all of its structure with its neighbours.
 */
export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'view': {
      const root = action.update(state.root)
      return root === state.root ? state : { ...state, root }
    }
    case 'commit': {
      const root = action.update(state.root)
      if (root === state.root) return state
      return { root, past: [...state.past, state.root].slice(-HISTORY_LIMIT), future: [] }
    }
    case 'undo': {
      const previous = state.past.at(-1)
      if (!previous) return state
      return { root: previous, past: state.past.slice(0, -1), future: [state.root, ...state.future].slice(0, HISTORY_LIMIT) }
    }
    case 'redo': {
      const [next, ...rest] = state.future
      if (!next) return state
      return { root: next, past: [...state.past, state.root].slice(-HISTORY_LIMIT), future: rest }
    }
  }
}
