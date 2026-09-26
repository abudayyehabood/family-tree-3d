import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Gender, TreeNode } from './model'
import { createDemoFamily, createEmptyTree, createStressTree } from './lib/generators'
import { computeLayout } from './lib/treeLayout'
import { exportTree, importTreeFile, loadTree, saveTree } from './lib/storage'
import {
  addChild,
  addChildToHusband,
  addWife,
  ancestorIds,
  buildIndex,
  collapseFromGeneration,
  deleteNode,
  expandNodes,
  nameUnknownMother,
  maxGeneration,
  renameNode,
  toggleCollapse,
} from './lib/tree'
import ConfirmDialog from './components/ConfirmDialog'
import NodeActions from './components/NodeActions'
import SidePanel from './components/SidePanel'
import Toolbar from './components/Toolbar'
import TreeCanvas from './components/TreeCanvas'
import type { TreeCanvasHandle } from './components/TreeCanvas'

/** Generated trees open with generation 4+ collapsed so the first view is a readable crown. */
const COLLAPSE_FROM_GENERATION = 4

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
  const [root, setRoot] = useState<TreeNode>(() => loadTree() ?? createDemoFamily())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null)

  const canvasRef = useRef<TreeCanvasHandle>(null)
  // Camera work that must wait until the next layout has been rendered.
  const pendingFitRef = useRef<'instant' | 'animated' | null>('instant')
  const pendingFocusRef = useRef<string | null>(null)

  const index = useMemo(() => buildIndex(root), [root])
  const layout = useMemo(() => computeLayout(root, index), [root, index])
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
    setRoot(next)
    notify(message)
  }

  const askReplace = (label: string, build: () => TreeNode, message: (n: number) => string) => {
    setConfirm({
      message: `سيتم استبدال الشجرة الحالية بـ«${label}». يمكنك تصدير الشجرة الحالية أولاً إن أردت الاحتفاظ بها.`,
      action: () => {
        const next = collapseFromGeneration(build(), COLLAPSE_FROM_GENERATION)
        replaceTree(next, message(buildIndex(next).size))
      },
    })
  }

  const handleToggle = useCallback((id: string) => setRoot((r) => toggleCollapse(r, id)), [])
  const handleRename = useCallback((id: string, name: string) => setRoot((r) => renameNode(r, id, name)), [])

  const focusPerson = (id: string) => {
    const hidden = ancestorIds(index, id).filter((a) => index.get(a)?.node.collapsed)
    setSelectedId(id)
    if (hidden.length) {
      pendingFocusRef.current = id
      setRoot((r) => expandNodes(r, hidden))
    } else {
      canvasRef.current?.focusNode(id)
    }
  }

  const handleAddWife = (husbandId: string) => {
    const result = addWife(root, husbandId, 'زوجة جديدة')
    if (!result) return notify('لا يمكن إضافة زوجة (الحد الأقصى 4)', true)
    setRoot(result.root)
    setSelectedId(result.id)
  }

  /** `parentId` is a wife, or a man (the child then goes under his unknown-mother knot). */
  const handleAddChild = (parentId: string, gender: Gender) => {
    const name = gender === 'male' ? 'ابن جديد' : 'بنت جديدة'
    const parent = index.get(parentId)?.node
    const result =
      parent?.type === 'member' ? addChildToHusband(root, parentId, gender, name) : addChild(root, parentId, gender, name)
    if (!result) return notify('تم بلوغ الحد الأقصى للأجيال (15)', true)
    setRoot(result.root)
    setSelectedId(result.id)
  }

  const handleDelete = (id: string) => {
    const name = index.get(id)?.node.name
    setRoot((r) => deleteNode(r, id))
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
        onStress={() => askReplace('شجرة اختبار 1500 شخص', () => createStressTree(Date.now()), (n) => `تم توليد ${n} شخص عبر 15 جيلاً`)}
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
            onNameMother={(id, name) => setRoot((r) => nameUnknownMother(r, id, name))}
            onAddWife={handleAddWife}
            onAddChild={handleAddChild}
            onDelete={handleDelete}
          />
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
