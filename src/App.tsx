import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { ArrowUp, TreeDeciduous } from 'lucide-react'
import type { Gender, TreeNode } from './model'
import { createDemoFamily, createEmptyTree, createStressTree } from './lib/generators'
import { computeLayout } from './lib/treeLayout'
import { historyReducer } from './lib/history'
import { exportTree, importTreeFile, loadTree, persistStorage, saveTree } from './lib/storage'
import {
  addChild,
  addChildToHusband,
  addWife,
  ancestorIds,
  buildIndex,
  collapseFromGeneration,
  deleteNode,
  expandAll,
  expandNodes,
  nameUnknownMother,
  maxGeneration,
  renameNode,
  toggleCollapse,
  updateDetails,
} from './lib/tree'
import ConfirmDialog from './components/ConfirmDialog'
import NodeActions from './components/NodeActions'
import SidePanel from './components/SidePanel'
import Toolbar from './components/Toolbar'
import TreeCanvas from './components/TreeCanvas'
import type { TreeCanvasHandle } from './components/TreeCanvas'

/**
 * Generated trees open with generation 4+ collapsed (3+ on phones) so the first view is a readable
 * crown.
 */
const collapseFromGenerationForScreen = () => (window.innerWidth < 640 ? 3 : 4)

interface Toast {
  id: number
  text: string
  error?: boolean
}

interface PendingConfirm {
  message: string
  action: () => void
}

export default function App() {
  const [history, dispatch] = useReducer(historyReducer, undefined, () => ({
    root: loadTree() ?? createDemoFamily(),
    past: [],
    future: [],
  }))
  const root = history.root
  const commit = useCallback((update: (current: TreeNode) => TreeNode) => dispatch({ type: 'commit', update }), [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null)
  /** Branch-focus mode: only this person's subtree is laid out (null = whole tree). */
  const [branchRootId, setBranchRootId] = useState<string | null>(null)

  const canvasRef = useRef<TreeCanvasHandle>(null)
  // Camera work that must wait until the next layout has been rendered.
  const pendingFitRef = useRef<'instant' | 'animated' | null>('instant')
  const pendingFocusRef = useRef<string | null>(null)

  const index = useMemo(() => buildIndex(root), [root])
  // A deleted branch root simply falls back to the whole tree.
  const viewRoot = (branchRootId && index.get(branchRootId)?.node) || root
  const layout = useMemo(() => computeLayout(viewRoot, index), [viewRoot, index])
  /** The father of the focused branch (its parent is a wife, whose parent is the father). */
  const branchFatherId = viewRoot !== root ? ancestorIds(index, viewRoot.id).find((a) => index.get(a)?.node.type === 'member') : undefined
  const generations = useMemo(() => maxGeneration(index), [index])
  const people = useMemo(() => [...index.values()].filter((e) => !e.node.unknown).length, [index])
  const selectedNode = selectedId ? index.get(selectedId)?.node : undefined

  useEffect(() => {
    if (pendingFitRef.current) {
      canvasRef.current?.centerTree(pendingFitRef.current === 'animated')
      pendingFitRef.current = null
    }
    if (pendingFocusRef.current) {
      canvasRef.current?.focusNode(pendingFocusRef.current)
      pendingFocusRef.current = null
    }
  }, [layout])

  useEffect(() => {
    void persistStorage()
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!saveTree(root)) setToast({ id: Date.now(), text: 'تعذّر الحفظ التلقائي في المتصفح', error: true })
    }, 400)
    return () => window.clearTimeout(timer)
  }, [root])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const notify = (text: string, error = false) => setToast({ id: Date.now(), text, error })

  const replaceTree = (next: TreeNode, message: string) => {
    pendingFitRef.current = 'animated'
    setSelectedId(null)
    setBranchRootId(null)
    commit(() => next)
    notify(message)
  }

  const askReplace = (label: string, build: () => TreeNode, message: (n: number) => string) => {
    setConfirm({
      message: `سيتم استبدال الشجرة الحالية بـ«${label}». يمكنك تصدير الشجرة الحالية أولاً إن أردت الاحتفاظ بها.`,
      action: () => {
        const next = collapseFromGeneration(build(), collapseFromGenerationForScreen())
        replaceTree(next, message(buildIndex(next).size))
      },
    })
  }

  const handleToggle = useCallback((id: string) => dispatch({ type: 'view', update: (r) => toggleCollapse(r, id) }), [])
  const handleRename = useCallback((id: string, name: string) => commit((r) => renameNode(r, id, name)), [commit])

  const canUndo = history.past.length > 0
  const canRedo = history.future.length > 0
  const undo = useCallback(() => {
    dispatch({ type: 'undo' })
    setSelectedId(null)
  }, [])
  const redo = useCallback(() => {
    dispatch({ type: 'redo' })
    setSelectedId(null)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Let the browser's own undo handle text being typed.
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo])

  /** Shows only `id`'s branch, or the whole tree when `id` is null. */
  const showBranch = (id: string | null) => {
    if ((id ?? root.id) === viewRoot.id) return
    pendingFitRef.current = 'animated'
    setBranchRootId(id === root.id ? null : id)
    if (id) dispatch({ type: 'view', update: (r) => expandNodes(r, [id]) })
  }

  const focusPerson = (id: string) => {
    // A person outside the focused branch brings back the whole tree.
    if (viewRoot !== root && id !== viewRoot.id && !ancestorIds(index, id).includes(viewRoot.id)) {
      setBranchRootId(null)
      const hidden = ancestorIds(index, id).filter((a) => index.get(a)?.node.collapsed)
      setSelectedId(id)
      pendingFocusRef.current = id
      dispatch({ type: 'view', update: (r) => expandNodes(r, hidden) })
      return
    }
    const hidden = ancestorIds(index, id).filter((a) => index.get(a)?.node.collapsed)
    setSelectedId(id)
    if (hidden.length) {
      pendingFocusRef.current = id
      dispatch({ type: 'view', update: (r) => expandNodes(r, hidden) })
    } else {
      canvasRef.current?.focusNode(id)
    }
  }

  /** Any man with a family can become the root of the view (except the one already shown there). */
  const canFocusBranch = (node: TreeNode) => node.type === 'member' && node.children.length > 0 && node.id !== viewRoot.id

  const handleAddWife = (husbandId: string) => {
    const result = addWife(root, husbandId, 'زوجة جديدة')
    if (!result) return notify('لا يمكن إضافة زوجة (الحد الأقصى 4)', true)
    commit(() => result.root)
    setSelectedId(result.id)
  }

  /** `parentId` is a wife, or a man (the child then goes under his unknown-mother knot). */
  const handleAddChild = (parentId: string, gender: Gender) => {
    const name = gender === 'male' ? 'ابن جديد' : 'بنت جديدة'
    const parent = index.get(parentId)?.node
    const result =
      parent?.type === 'member' ? addChildToHusband(root, parentId, gender, name) : addChild(root, parentId, gender, name)
    if (!result) return notify('تم بلوغ الحد الأقصى للأجيال (15)', true)
    commit(() => result.root)
    setSelectedId(result.id)
  }

  const handleDelete = (id: string) => {
    const name = index.get(id)?.node.name
    commit((r) => deleteNode(r, id))
    setSelectedId(null)
    notify(`تم حذف «${name}»`)
  }

  const handleImport = async (file: File) => {
    try {
      const next = await importTreeFile(file)
      replaceTree(next, `تم استيراد ${buildIndex(next).size} شخص`)
    } catch (err) {
      notify(err instanceof Error ? err.message : 'تعذّر استيراد الملف', true)
    }
  }

  return (
    <div dir="rtl" className="relative flex h-full flex-col">
      <Toolbar
        index={index}
        onSearchPick={focusPerson}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        onStress={() => askReplace('شجرة اختبار 700 شخص', () => createStressTree(Date.now()), (n) => `تم توليد ${n} شخص عبر 15 جيلاً`)}
        onExpandAll={() => {
          pendingFitRef.current = 'animated'
          dispatch({ type: 'view', update: expandAll })
        }}
        onDemo={() => askReplace('عائلة تجريبية صغيرة', createDemoFamily, (n) => `تم تحميل عائلة تجريبية (${n} شخص)`)}
        onReset={() => askReplace('شجرة جديدة فارغة', createEmptyTree, () => 'تم إنشاء شجرة جديدة')}
        onExport={() => {
          exportTree(root)
          notify('تم تصدير الشجرة')
        }}
        onImport={handleImport}
      />

      <main className="relative flex-1 overflow-hidden bg-[radial-gradient(ellipse_at_50%_110%,#efe3c6_0%,#e7efdc_45%,#dde9ef_100%)]">
        <TreeCanvas
          ref={canvasRef}
          layout={layout}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onToggle={handleToggle}
          onRename={handleRename}
          actions={
            selectedNode && (
              <NodeActions
                node={selectedNode}
                isRoot={selectedNode.id === root.id}
                onEditName={(id) => canvasRef.current?.editName(id)}
                onAddWife={handleAddWife}
                onAddChild={handleAddChild}
                onFocusBranch={canFocusBranch(selectedNode) ? showBranch : undefined}
                onDelete={(id) =>
                  setConfirm({
                    message: `سيتم حذف «${index.get(id)?.node.name}»${
                      index.get(id)?.descendants ? ` مع ${index.get(id)?.descendants} من الذرية` : ''
                    }. لا يمكن التراجع.`,
                    action: () => handleDelete(id),
                  })
                }
              />
            )
          }
        />

        {selectedNode && (
          <SidePanel
            key={selectedNode.id}
            node={selectedNode}
            index={index}
            onClose={() => setSelectedId(null)}
            onRename={handleRename}
            onNameMother={(id, name) => commit((r) => nameUnknownMother(r, id, name))}
            onAddWife={handleAddWife}
            onAddChild={handleAddChild}
            onDelete={handleDelete}
            onSaveDetails={(id, details) => commit((r) => updateDetails(r, id, details))}
            onFocusBranch={canFocusBranch(selectedNode) ? showBranch : undefined}
          />
        )}

        {viewRoot !== root && (
          <div className="absolute top-1 left-1 z-20 flex max-w-[calc(100%-0.5rem)] items-center gap-1 rounded-full bg-[#3b2412]/95 p-0.5 text-xs text-amber-50 shadow-xl sm:top-3 sm:left-3 sm:gap-1.5 sm:p-1.5 sm:text-sm">
            <span className="min-w-0 truncate px-2 font-bold">فرع «{viewRoot.name}»</span>
            {branchFatherId && (
              <button
                type="button"
                onClick={() => showBranch(branchFatherId)}
                title="فرع الأب"
                className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-white/10 px-2 font-semibold hover:bg-white/25 sm:h-9 sm:px-3"
              >
                <ArrowUp className="size-3 sm:size-4" />
                الأب
              </button>
            )}
            <button
              type="button"
              onClick={() => showBranch(null)}
              className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-amber-500 px-2 font-bold text-amber-950 hover:bg-amber-400 sm:h-9 sm:gap-1.5 sm:px-3"
            >
              <TreeDeciduous className="size-3 sm:size-4" />
              الشجرة كاملة
            </button>
          </div>
        )}

        <div className="pointer-events-none absolute bottom-5 left-1/2 z-10 hidden -translate-x-1/2 rounded-full bg-white/80 px-4 py-1.5 text-xs font-semibold whitespace-nowrap text-stone-700 shadow backdrop-blur sm:block">
          {people} شخص · {generations} {generations > 10 || generations < 3 ? 'جيل' : 'أجيال'} · حفظ تلقائي
        </div>

        {toast && (
          <div
            key={toast.id}
            role="status"
            className={`absolute top-4 left-1/2 z-40 -translate-x-1/2 rounded-full px-5 py-2 text-sm font-semibold shadow-lg ${
              toast.error ? 'bg-red-700 text-white' : 'bg-[#2f4a22] text-lime-50'
            }`}
          >
            {toast.text}
          </div>
        )}

        {confirm && (
          <ConfirmDialog
            message={confirm.message}
            onCancel={() => setConfirm(null)}
            onConfirm={() => {
              confirm.action()
              setConfirm(null)
            }}
          />
        )}
      </main>
    </div>
  )
}
