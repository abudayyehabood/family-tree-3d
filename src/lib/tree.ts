import { MAX_GENERATION, MAX_WIVES } from '../model'
import type { Gender, TreeNode } from '../model'

let idCounter = 0
export function newId(): string {
  idCounter += 1
  return `n${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function createFounder(name = 'الجد المؤسس'): TreeNode {
  return { id: newId(), type: 'member', name, gender: 'male', generation: 1, children: [] }
}

export interface IndexEntry {
  node: TreeNode
  parentId: string | null
  /** Number of people in the full (uncollapsed) subtree, excluding the node itself. */
  descendants: number
}

export type TreeIndex = Map<string, IndexEntry>

export function buildIndex(root: TreeNode): TreeIndex {
  const index: TreeIndex = new Map()
  const visit = (node: TreeNode, parentId: string | null): number => {
    const entry: IndexEntry = { node, parentId, descendants: 0 }
    index.set(node.id, entry)
    let count = 0
    for (const child of node.children) count += 1 + visit(child, node.id)
    entry.descendants = count
    return count
  }
  visit(root, null)
  return index
}

export function ancestorIds(index: TreeIndex, id: string): string[] {
  const result: string[] = []
  let current = index.get(id)?.parentId ?? null
  while (current) {
    result.push(current)
    current = index.get(current)?.parentId ?? null
  }
  return result
}

/** Rebuilds the tree bottom-up, keeping untouched branches referentially identical. */
function transform(node: TreeNode, fn: (node: TreeNode) => TreeNode): TreeNode {
  let changed = false
  const children = node.children.map((child) => {
    const next = transform(child, fn)
    if (next !== child) changed = true
    return next
  })
  return fn(changed ? { ...node, children } : node)
}

export function updateNode(root: TreeNode, id: string, fn: (node: TreeNode) => TreeNode): TreeNode {
  return transform(root, (node) => (node.id === id ? fn(node) : node))
}

export function renameNode(root: TreeNode, id: string, name: string): TreeNode {
  return updateNode(root, id, (node) => ({ ...node, name }))
}

export function toggleCollapse(root: TreeNode, id: string): TreeNode {
  return updateNode(root, id, (node) =>
    node.children.length ? { ...node, collapsed: !node.collapsed } : node,
  )
}

export function expandNodes(root: TreeNode, ids: Iterable<string>): TreeNode {
  const set = new Set(ids)
  return transform(root, (node) => (set.has(node.id) && node.collapsed ? { ...node, collapsed: false } : node))
}

export function canAddWife(node: TreeNode): boolean {
  return node.type === 'member' && node.gender === 'male' && node.children.length < MAX_WIVES
}

export function canAddChild(node: TreeNode): boolean {
  return node.type === 'wife' && node.generation < MAX_GENERATION
}

export function addWife(root: TreeNode, husbandId: string, name: string): { root: TreeNode; id: string } | null {
  let createdId: string | null = null
  const next = updateNode(root, husbandId, (husband) => {
    if (!canAddWife(husband)) return husband
    const wife: TreeNode = {
      id: newId(),
      type: 'wife',
      name,
      gender: 'female',
      generation: husband.generation,
      children: [],
    }
    createdId = wife.id
    return { ...husband, collapsed: false, children: [...husband.children, wife] }
  })
  return createdId ? { root: next, id: createdId } : null
}

export function addChild(
  root: TreeNode,
  wifeId: string,
  gender: Gender,
  name: string,
): { root: TreeNode; id: string } | null {
  let createdId: string | null = null
  const next = updateNode(root, wifeId, (wife) => {
    if (!canAddChild(wife)) return wife
    const child: TreeNode = {
      id: newId(),
      type: 'member',
      name,
      gender,
      generation: wife.generation + 1,
      children: [],
    }
    createdId = child.id
    return { ...wife, collapsed: false, children: [...wife.children, child] }
  })
  return createdId ? { root: next, id: createdId } : null
}

export function deleteNode(root: TreeNode, id: string): TreeNode {
  if (root.id === id) return root
  return transform(root, (node) =>
    node.children.some((c) => c.id === id)
      ? { ...node, children: node.children.filter((c) => c.id !== id) }
      : node,
  )
}

export function maxGeneration(index: TreeIndex): number {
  let max = 1
  for (const { node } of index.values()) if (node.generation > max) max = node.generation
  return max
}

/**
 * Validates untrusted JSON and returns a clean tree that obeys every lineage rule.
 * Throws an Error with an Arabic message describing the first violation.
 */
export function validateTree(input: unknown): TreeNode {
  const data =
    input && typeof input === 'object' && 'root' in input ? (input as { root: unknown }).root : input
  const seen = new Set<string>()

  const clean = (raw: unknown, expectedType: 'member' | 'wife', expectedGen: number, path: string): TreeNode => {
    if (!raw || typeof raw !== 'object') throw new Error(`عنصر غير صالح في ${path}`)
    const r = raw as Record<string, unknown>
    if (r.type !== expectedType) throw new Error(`نوع غير متوقع في ${path}: المتوقع ${expectedType === 'wife' ? 'زوجة' : 'فرد'}`)
    if (typeof r.name !== 'string' || !r.name.trim()) throw new Error(`اسم مفقود في ${path}`)
    const gender: Gender = expectedType === 'wife' ? 'female' : r.gender === 'female' ? 'female' : 'male'
    if (expectedType === 'member' && r.gender !== 'male' && r.gender !== 'female') {
      throw new Error(`الجنس غير محدد لـ «${r.name}»`)
    }
    if (expectedGen > MAX_GENERATION) throw new Error(`«${r.name}» يتجاوز الحد الأقصى للأجيال (${MAX_GENERATION})`)
    let id = typeof r.id === 'string' && r.id ? r.id : newId()
    if (seen.has(id)) id = newId()
    seen.add(id)

    const rawChildren = r.children === undefined ? [] : r.children
    if (!Array.isArray(rawChildren)) throw new Error(`قائمة الأبناء غير صالحة لـ «${r.name}»`)

    let children: TreeNode[] = []
    const label = `«${r.name}»`
    if (expectedType === 'member') {
      if (gender === 'female' && rawChildren.length) throw new Error(`${label}: لا يمكن إضافة فروع إلى الأنثى`)
      if (rawChildren.length > MAX_WIVES) throw new Error(`${label}: الحد الأقصى ${MAX_WIVES} زوجات`)
      children = rawChildren.map((c, i) => clean(c, 'wife', expectedGen, `${label} ← زوجة ${i + 1}`))
    } else {
      if (rawChildren.length && expectedGen >= MAX_GENERATION) {
        throw new Error(`${label}: لا يمكن إضافة أبناء بعد الجيل ${MAX_GENERATION}`)
      }
      children = rawChildren.map((c, i) => clean(c, 'member', expectedGen + 1, `${label} ← ابن ${i + 1}`))
    }

    return {
      id,
      type: expectedType,
      name: r.name.trim(),
      gender,
      generation: expectedGen,
      collapsed: r.collapsed === true && children.length > 0 ? true : undefined,
      children,
    }
  }

  const root = clean(data, 'member', 1, 'الجذر')
  if (root.gender !== 'male') throw new Error('يجب أن يكون المؤسس ذكراً')
  return root
}

/** Collapses every member from `generation` onward, so large trees open as a readable crown. */
export function collapseFromGeneration(root: TreeNode, generation: number): TreeNode {
  return transform(root, (node) =>
    node.type === 'member' && node.generation >= generation && node.children.length && !node.collapsed
      ? { ...node, collapsed: true }
      : node,
  )
}
