export type NodeType = 'member' | 'wife'
export type Gender = 'male' | 'female'

export interface TreeNode {
  id: string
  type: NodeType
  name: string
  /** Wives are always 'female'. */
  gender: Gender
  /** A wife shares her husband's generation. */
  generation: number
  collapsed?: boolean
  /** Placeholder wife for children whose mother's name is not known; drawn as a small knot. */
  unknown?: boolean
  /** Year of birth / death (Gregorian, year only). */
  born?: number
  died?: number
  /** Husband's name, for daughters only (a name tag, not a branch: the tree stays patrilineal). */
  husband?: string
  children: TreeNode[]
}

export const MAX_GENERATION = 15
export const MAX_WIVES = 4

export const UNKNOWN_MOTHER_NAME = 'غير معروفة'
