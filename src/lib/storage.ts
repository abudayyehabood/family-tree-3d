import type { TreeNode } from '../model'
import { validateTree } from './tree'

const STORAGE_KEY = 'organic_family_tree_v3'
/** Keys written by earlier versions; their data is discarded. */
const LEGACY_KEYS = ['arabic-family-tree:v1']

/**
 * Asks the browser to keep this origin's storage.
 *
 * iOS Safari clears script-writable storage for sites the user has not opened in seven days, which
 * for a family tree kept in localStorage means it is simply gone — the exact case where nobody has
 * a recent export either. Granting is at the browser's discretion (Safari weighs it against how
 * the site is used, Chrome against engagement and whether it is installed), so the answer is worth
 * reporting rather than assuming.
 */
export async function persistStorage(): Promise<'granted' | 'denied' | 'unsupported'> {
  try {
    if (!navigator.storage?.persist) return 'unsupported'
    if (await navigator.storage.persisted()) return 'granted'
    return (await navigator.storage.persist()) ? 'granted' : 'denied'
  } catch {
    return 'unsupported'
  }
}

export function loadTree(): TreeNode | null {
  try {
    for (const key of LEGACY_KEYS) localStorage.removeItem(key)
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? validateTree(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function saveTree(root: TreeNode): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(root))
    return true
  } catch {
    return false
  }
}

export function exportTree(root: TreeNode): void {
  const payload = { app: 'arabic-family-tree', version: 1, exportedAt: new Date().toISOString(), root }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `family-tree-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export async function importTreeFile(file: File): Promise<TreeNode> {
  const text = await file.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('الملف ليس بصيغة JSON صالحة')
  }
  return validateTree(parsed)
}
