import { useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Search, X } from 'lucide-react'
import type { TreeNode } from '../model'
import { normalizeArabic } from '../lib/search'
import type { TreeIndex } from '../lib/tree'

interface SearchBarProps {
  index: TreeIndex
  onPick: (id: string) => void
}

interface SearchEntry {
  node: TreeNode
  norm: string
  subtitle: string
}

const MAX_RESULTS = 30

function describe(index: TreeIndex, node: TreeNode): string {
  const parent = index.get(node.id)?.parentId
  const parentNode = parent ? index.get(parent)?.node : undefined
  if (node.type === 'wife') return `زوجة ${parentNode?.name ?? ''} · الجيل ${node.generation}`
  if (!parentNode) return 'المؤسس · الجيل 1'
  const fatherId = index.get(parentNode.id)?.parentId
  const father = fatherId ? index.get(fatherId)?.node : undefined
  const mother = parentNode.unknown ? '' : ` و${parentNode.name}`
  return `${node.gender === 'male' ? 'ابن' : 'بنت'} ${father?.name ?? ''}${mother} · الجيل ${node.generation}`
}

export default function SearchBar({ index, onPick }: SearchBarProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const entries = useMemo<SearchEntry[]>(() => {
    const list: SearchEntry[] = []
    for (const { node } of index.values()) if (!node.unknown) list.push({ node, norm: normalizeArabic(node.name), subtitle: describe(index, node) })
    return list
  }, [index])

  const results = useMemo(() => {
    const q = normalizeArabic(query)
    if (!q) return []
    const starts: SearchEntry[] = []
    const contains: SearchEntry[] = []
    for (const e of entries) {
      if (e.norm.startsWith(q)) starts.push(e)
      else if (e.norm.includes(q)) contains.push(e)
      if (starts.length >= MAX_RESULTS) break
    }
    return [...starts, ...contains].slice(0, MAX_RESULTS)
  }, [entries, query])

  const pick = (entry: SearchEntry) => {
    onPick(entry.node.id)
    setOpen(false)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(results.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter' && results[active]) {
      pick(results[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="relative min-w-0 flex-1 sm:max-w-sm">
      <Search className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-amber-900/60" />
      <input
        type="search"
        value={query}
        placeholder="ابحث عن شخص…"
        aria-label="بحث"
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className="h-9 w-full rounded-full border border-amber-200/40 bg-amber-50/95 pr-9 pl-8 text-base text-stone-900 sm:text-sm placeholder:text-stone-500 shadow-inner outline-none focus:ring-2 focus:ring-amber-400 [&::-webkit-search-cancel-button]:hidden"
      />
      {query && (
        <button
          type="button"
          aria-label="مسح"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setQuery('')}
          className="absolute top-1/2 left-2.5 -translate-y-1/2 rounded-full p-0.5 text-stone-500 hover:bg-stone-200"
        >
          <X className="size-4" />
        </button>
      )}
      {open && query && (
        <ul className="absolute top-full right-0 left-0 z-50 mt-2 max-h-80 overflow-y-auto rounded-xl border border-amber-900/15 bg-amber-50 py-1 shadow-xl">
          {results.length === 0 && <li className="px-4 py-3 text-sm text-stone-500">لا توجد نتائج</li>}
          {results.map((r, i) => (
            <li key={r.node.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(r)}
                className={`flex w-full items-center gap-3 px-4 py-2 text-right ${i === active ? 'bg-amber-200/70' : ''}`}
              >
                <span
                  className={`size-2.5 shrink-0 rounded-full ${
                    r.node.type === 'wife' ? 'bg-amber-500' : r.node.gender === 'male' ? 'bg-green-700' : 'bg-pink-700'
                  }`}
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-stone-900">{r.node.name}</span>
                  <span className="block truncate text-xs text-stone-600">{r.subtitle}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
