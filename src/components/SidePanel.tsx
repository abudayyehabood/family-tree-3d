import { useState } from 'react'
import type { ReactNode } from 'react'
import { Baby, Check, Crown, Heart, Save, Trash2, User, UserPlus, X } from 'lucide-react'
import { MAX_GENERATION, MAX_WIVES } from '../model'
import type { Gender, TreeNode } from '../model'
import { wifeCount } from '../lib/tree'
import type { TreeIndex } from '../lib/tree'

const UNKNOWN = '__unknown__'

interface SidePanelProps {
  node: TreeNode
  index: TreeIndex
  onClose: () => void
  onRename: (id: string, name: string) => void
  onNameMother: (husbandId: string, name: string) => void
  onAddWife: (husbandId: string) => void
  onAddChild: (parentId: string, gender: Gender) => void
  onDelete: (id: string) => void
}

function ActionButton({
  children,
  onClick,
  disabled,
  title,
  tone,
  wide,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  title?: string
  tone: 'green' | 'pink' | 'amber' | 'red'
  wide?: boolean
}) {
  const tones = {
    green: 'bg-green-700 text-white hover:bg-green-600',
    pink: 'bg-pink-700 text-white hover:bg-pink-600',
    amber: 'bg-amber-500 text-amber-950 hover:bg-amber-400',
    red: 'border border-red-300 bg-red-50 text-red-700 hover:bg-red-100',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex h-10 items-center justify-center gap-1.5 rounded-lg text-sm font-bold shadow-sm transition disabled:cursor-not-allowed disabled:border-stone-200 disabled:bg-stone-200 disabled:text-stone-400 ${
        wide ? 'col-span-2' : ''
      } ${tones[tone]}`}
    >
      {children}
    </button>
  )
}

/**
 * The editing sheet for the selected person: rename, then the four actions that matter
 * (son, daughter, wife, delete). A top sheet on phones so the keyboard never covers it,
 * and a short side panel from `sm` up — it must never take over the whole screen.
 */
export default function SidePanel({ node, index, onClose, onRename, onNameMother, onAddWife, onAddChild, onDelete }: SidePanelProps) {
  const [draft, setDraft] = useState(node.name)
  const [savedName, setSavedName] = useState(node.name)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [motherId, setMotherId] = useState<string | null>(null)
  const [motherName, setMotherName] = useState('')

  const entry = index.get(node.id)
  const descendants = entry?.descendants ?? 0
  const isRoot = !entry?.parentId

  const isWife = node.type === 'wife'
  const isMale = node.type === 'member' && node.gender === 'male'
  const wives = isMale ? wifeCount(node) : 0
  const unknownMother = isMale ? node.children.find((w) => w.unknown) : undefined
  const atGenerationLimit = node.generation >= MAX_GENERATION

  /** Children hang under a wife: the wife herself, or one of the husband's wives. */
  const mothers = isWife ? [node] : isMale ? node.children : []
  /** A man can also get children with no named mother; they go under an unknown-mother knot. */
  const offerUnknown = isMale && !unknownMother
  const mother = motherId === UNKNOWN ? undefined : (mothers.find((m) => m.id === motherId) ?? mothers[0])
  const childParentId = mother ? mother.id : offerUnknown ? node.id : undefined
  const canAddChildren = !!childParentId && !atGenerationLimit
  /** The picker only earns its space when there is an actual choice of mother. */
  const showMotherPicker = isMale && mothers.length + (offerUnknown ? 1 : 0) > 1
  const childHint = atGenerationLimit
    ? `الحد الأقصى ${MAX_GENERATION} جيلاً`
    : !childParentId
      ? 'الأنثى نهاية الفرع؛ يُضاف الأبناء تحت الأم'
      : null

  const Icon = isRoot ? Crown : isWife ? Heart : User
  const iconTone = isRoot ? 'bg-amber-800 text-amber-100' : isWife ? 'bg-amber-400 text-amber-950' : isMale ? 'bg-green-700 text-white' : 'bg-pink-700 text-white'

  // A rename from elsewhere (e.g. double-click editing on the tree) resets the draft.
  if (savedName !== node.name) {
    setSavedName(node.name)
    setDraft(node.name)
  }
  const trimmed = draft.trim()
  const dirty = trimmed !== node.name
  const saveName = () => {
    if (trimmed && dirty) onRename(node.id, trimmed)
  }

  return (
    <aside
      className="absolute inset-x-2 top-2 z-30 flex max-h-[70vh] flex-col overflow-hidden rounded-2xl border border-amber-900/20 bg-[#fbf6ea]/97 shadow-2xl backdrop-blur sm:inset-x-auto sm:top-3 sm:right-3 sm:w-80"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 border-b border-amber-900/10 bg-amber-100/60 px-3 py-2">
        <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${iconTone}`}>
          <Icon className="size-4" />
        </span>
        <p className="min-w-0 flex-1 truncate text-sm font-extrabold text-stone-900">{node.name}</p>
        <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-lg p-1.5 text-stone-500 hover:bg-amber-200/60">
          <X className="size-5" />
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            saveName()
          }}
        >
          <input
            id="person-name"
            value={draft}
            aria-label="الاسم"
            autoComplete="off"
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => e.target.select()}
            className="h-10 min-w-0 flex-1 rounded-lg border-2 border-green-700/40 bg-white px-3 text-base font-extrabold text-stone-900 outline-none focus:border-green-600 focus:ring-2 focus:ring-green-300"
          />
          <button
            type="submit"
            disabled={!trimmed || !dirty}
            aria-label="حفظ الاسم"
            title="حفظ الاسم"
            className="grid size-10 shrink-0 place-items-center rounded-lg bg-green-700 text-white shadow transition hover:bg-green-600 disabled:bg-stone-200 disabled:text-stone-400"
          >
            {dirty || !trimmed ? <Save className="size-4" /> : <Check className="size-4" />}
          </button>
        </form>

        {showMotherPicker && (
          <label className="block text-xs text-stone-600">
            الأم
            <select
              value={mother?.id ?? UNKNOWN}
              onChange={(e) => setMotherId(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-amber-900/25 bg-white px-2 text-sm font-bold text-stone-900 outline-none focus:ring-2 focus:ring-green-300"
            >
              {mothers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
              {offerUnknown && <option value={UNKNOWN}>غير معروفة (بدون اسم)</option>}
            </select>
          </label>
        )}

        <div className="grid grid-cols-2 gap-1.5">
          <ActionButton
            tone="green"
            onClick={() => childParentId && onAddChild(childParentId, 'male')}
            disabled={!canAddChildren}
            title={childHint ?? 'إضافة ابن'}
          >
            <UserPlus className="size-4" />
            ابن
          </ActionButton>
          <ActionButton
            tone="pink"
            onClick={() => childParentId && onAddChild(childParentId, 'female')}
            disabled={!canAddChildren}
            title={childHint ?? 'إضافة بنت'}
          >
            <Baby className="size-4" />
            بنت
          </ActionButton>
          {isMale && (
            <ActionButton
              tone="amber"
              onClick={() => onAddWife(node.id)}
              disabled={wives >= MAX_WIVES}
              title={wives >= MAX_WIVES ? `الحد الأقصى ${MAX_WIVES} زوجات` : 'إضافة زوجة'}
            >
              <Heart className="size-4" />
              زوجة ({wives}/{MAX_WIVES})
            </ActionButton>
          )}
          <ActionButton
            tone="red"
            wide={!isMale}
            onClick={() => setConfirmDelete(true)}
            disabled={isRoot}
            title={isRoot ? 'لا يمكن حذف المؤسس' : 'حذف'}
          >
            <Trash2 className="size-4" />
            حذف
          </ActionButton>
        </div>

        {childHint && <p className="rounded-lg bg-amber-100 px-2.5 py-1.5 text-xs text-amber-900">{childHint}</p>}

        {confirmDelete && !isRoot && (
          <div className="space-y-1.5 rounded-lg border border-red-200 bg-red-50/70 p-2">
            <p className="text-xs text-red-800">
              حذف «{node.name}»{descendants > 0 ? ` مع ${descendants} من الذرية` : ''}؟ لا يمكن التراجع.
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              <button type="button" onClick={() => onDelete(node.id)} className="h-9 rounded-lg bg-red-700 text-sm font-bold text-white hover:bg-red-600">
                تأكيد
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="h-9 rounded-lg border border-stone-300 bg-white text-sm font-semibold hover:bg-stone-50">
                إلغاء
              </button>
            </div>
          </div>
        )}

        {unknownMother && (
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              if (motherName.trim()) onNameMother(node.id, motherName.trim())
            }}
          >
            <input
              id="mother-name"
              value={motherName}
              aria-label="اسم الأم غير المعروفة"
              autoComplete="off"
              onChange={(e) => setMotherName(e.target.value)}
              placeholder={`اسم أم الأبناء (${unknownMother.children.length})`}
              className="h-9 min-w-0 flex-1 rounded-lg border border-amber-900/25 bg-white px-2 text-base font-bold outline-none focus:ring-2 focus:ring-green-300"
            />
            <button
              type="submit"
              disabled={!motherName.trim() || wives >= MAX_WIVES}
              title={wives >= MAX_WIVES ? `الحد الأقصى ${MAX_WIVES} زوجات` : undefined}
              className="h-9 shrink-0 rounded-lg bg-amber-500 px-3 text-xs font-bold text-amber-950 hover:bg-amber-400 disabled:bg-stone-200 disabled:text-stone-400"
            >
              حفظ
            </button>
          </form>
        )}
      </div>
    </aside>
  )
}
