import { useState } from 'react'
import type { ReactNode } from 'react'
import { Baby, Check, Crown, GitBranch, Heart, Save, Trash2, User, UserPlus, X } from 'lucide-react'
import { MAX_GENERATION, MAX_WIVES } from '../model'
import type { Gender, TreeNode } from '../model'
import { parseYear, wifeCount } from '../lib/tree'
import type { PersonDetails, TreeIndex } from '../lib/tree'

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
  onSaveDetails: (id: string, details: PersonDetails) => void
  /** Shows only this person's branch (undefined when not offered). */
  onFocusBranch?: (id: string) => void
}

const yearText = (y?: number) => (y ? String(y) : '')

/**
 * Birth/death years for everyone, plus the husband's name for daughters (a name tag only; the tree
 * stays patrilineal). One compact row, like the rest of the strip.
 */
function DetailsForm({ node, onSave }: { node: TreeNode; onSave: (details: PersonDetails) => void }) {
  const isDaughter = node.type === 'member' && node.gender === 'female'
  const [born, setBorn] = useState(yearText(node.born))
  const [died, setDied] = useState(yearText(node.died))
  const [husband, setHusband] = useState(node.husband ?? '')

  const bornYear = parseYear(born)
  const diedYear = parseYear(died)
  const error =
    (born.trim() && !bornYear) || (died.trim() && !diedYear)
      ? 'اكتب السنة بالأرقام، مثل 1950'
      : bornYear && diedYear && diedYear < bornYear
        ? 'سنة الوفاة قبل سنة الميلاد'
        : null
  const dirty = born.trim() !== yearText(node.born) || died.trim() !== yearText(node.died) || (isDaughter && husband.trim() !== (node.husband ?? ''))
  const input =
    'h-7 min-w-0 rounded-md border border-amber-900/25 bg-white px-1.5 text-base leading-none font-bold text-stone-900 outline-none focus:ring-2 focus:ring-green-300 sm:h-9 sm:rounded-lg sm:px-2 sm:text-sm'

  return (
    <form
      className="basis-full space-y-1 sm:basis-auto"
      onSubmit={(e) => {
        e.preventDefault()
        if (!error && dirty) onSave({ born: bornYear, died: diedYear, husband: isDaughter ? husband : undefined })
      }}
    >
      <div className="flex gap-1 sm:gap-1.5">
        {isDaughter && (
          <input value={husband} onChange={(e) => setHusband(e.target.value)} aria-label="اسم الزوج" placeholder="اسم الزوج" autoComplete="off" className={`flex-[2] ${input}`} />
        )}
        <input value={born} onChange={(e) => setBorn(e.target.value)} aria-label="سنة الميلاد" placeholder="ميلاد" inputMode="numeric" dir="ltr" className={`w-0 flex-1 text-center ${input}`} />
        <input value={died} onChange={(e) => setDied(e.target.value)} aria-label="سنة الوفاة" placeholder="وفاة" inputMode="numeric" dir="ltr" className={`w-0 flex-1 text-center ${input}`} />
        <button
          type="submit"
          disabled={!dirty || !!error}
          aria-label="حفظ التفاصيل"
          title="حفظ التفاصيل"
          className="grid size-7 shrink-0 place-items-center rounded-md bg-green-700 text-white shadow transition hover:bg-green-600 disabled:bg-stone-200 disabled:text-stone-400 sm:size-9 sm:rounded-lg"
        >
          {dirty ? <Save className="size-3.5 sm:size-4" /> : <Check className="size-3.5 sm:size-4" />}
        </button>
      </div>
      {error && <p className="text-xs font-semibold text-red-700">{error}</p>}
    </form>
  )
}

/** A colour-coded icon square on phones; icon plus label in a two-column grid from `sm` up. */
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
  title: string
  tone: 'green' | 'pink' | 'amber' | 'red' | 'lime'
  wide?: boolean
}) {
  const tones = {
    green: 'bg-green-700 text-white hover:bg-green-600',
    pink: 'bg-pink-700 text-white hover:bg-pink-600',
    amber: 'bg-amber-500 text-amber-950 hover:bg-amber-400',
    red: 'border border-red-300 bg-red-50 text-red-700 hover:bg-red-100',
    lime: 'bg-lime-200 text-green-950 hover:bg-lime-100',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`grid size-7 shrink-0 place-items-center rounded-md text-sm font-bold shadow-sm transition disabled:cursor-not-allowed disabled:border-stone-200 disabled:bg-stone-200 disabled:text-stone-400 sm:flex sm:size-auto sm:h-9 sm:items-center sm:justify-center sm:gap-1.5 sm:rounded-lg ${
        wide ? 'sm:col-span-2' : ''
      } ${tones[tone]}`}
    >
      {children}
    </button>
  )
}

/**
 * The editing sheet for the selected person: rename, then the four actions that matter
 * (son, daughter, wife, delete).
 *
 * On a phone it is a single 36px-tall strip across the top — name field and four icon buttons in
 * one row — because anything taller buries the tree it is meant to edit. Extra rows (mother
 * picker, delete confirmation) wrap underneath only when they apply. From `sm` up it becomes the
 * familiar labelled side panel.
 */
export default function SidePanel({
  node,
  index,
  onClose,
  onRename,
  onNameMother,
  onAddWife,
  onAddChild,
  onDelete,
  onSaveDetails,
  onFocusBranch,
}: SidePanelProps) {
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
      className="absolute inset-x-1 top-1 z-30 flex flex-col overflow-hidden rounded-lg border border-amber-900/20 bg-[#fbf6ea]/97 shadow-2xl backdrop-blur sm:inset-x-auto sm:top-3 sm:right-3 sm:max-h-[70vh] sm:w-80 sm:rounded-2xl"
      onClick={(e) => e.stopPropagation()}
    >
      {/* The name field doubles as the title on a phone, so this header is desktop-only. */}
      <div className="hidden items-center gap-2 border-b border-amber-900/10 bg-amber-100/60 px-3 py-2 sm:flex">
        <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${iconTone}`}>
          <Icon className="size-4" />
        </span>
        <p className="min-w-0 flex-1 truncate text-sm font-extrabold text-stone-900">{node.name}</p>
        <span className="shrink-0 rounded-full bg-green-800 px-2 py-0.5 text-xs font-bold text-amber-50">الجيل {node.generation}</span>
        <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-lg p-1 text-stone-500 hover:bg-amber-200/60">
          <X className="size-5" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1 overflow-y-auto p-1 sm:flex-col sm:flex-nowrap sm:items-stretch sm:gap-2 sm:p-3">
        <form
          className="flex min-w-0 flex-1 gap-1 sm:w-full sm:flex-none sm:gap-1.5"
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
            className="h-7 min-w-0 flex-1 rounded-md border-2 border-green-700/40 bg-white px-1.5 text-base leading-none font-extrabold text-stone-900 outline-none focus:border-green-600 focus:ring-2 focus:ring-green-300 sm:h-10 sm:rounded-lg sm:px-3"
          />
          <button
            type="submit"
            disabled={!trimmed || !dirty}
            aria-label="حفظ الاسم"
            title="حفظ الاسم"
            className="grid size-7 shrink-0 place-items-center rounded-md bg-green-700 text-white shadow transition hover:bg-green-600 disabled:bg-stone-200 disabled:text-stone-400 sm:size-10 sm:rounded-lg"
          >
            {dirty || !trimmed ? <Save className="size-3.5 sm:size-4" /> : <Check className="size-3.5 sm:size-4" />}
          </button>
        </form>

        {/*
          Desktop only. On a phone a new child goes to the first wife, and you pick a different
          mother by selecting *her* card and adding the child from there — which beats spending a
          second row of the strip on a control most people never need.
        */}
        {showMotherPicker && (
          <label className="hidden items-center gap-2 text-xs text-stone-600 sm:flex">
            الأم
            <select
              value={mother?.id ?? UNKNOWN}
              onChange={(e) => setMotherId(e.target.value)}
              className="h-8 min-w-0 flex-1 rounded-lg border border-amber-900/25 bg-white px-2 text-sm font-bold text-stone-900 outline-none focus:ring-2 focus:ring-green-300"
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

        <div className="flex shrink-0 items-center gap-1 sm:grid sm:w-full sm:grid-cols-2 sm:gap-1.5">
          <ActionButton
            tone="green"
            onClick={() => childParentId && onAddChild(childParentId, 'male')}
            disabled={!canAddChildren}
            title={childHint ?? 'إضافة ابن'}
          >
            <UserPlus className="size-3.5 sm:size-4" />
            <span className="hidden sm:inline">ابن</span>
          </ActionButton>
          <ActionButton
            tone="pink"
            onClick={() => childParentId && onAddChild(childParentId, 'female')}
            disabled={!canAddChildren}
            title={childHint ?? 'إضافة بنت'}
          >
            <Baby className="size-3.5 sm:size-4" />
            <span className="hidden sm:inline">بنت</span>
          </ActionButton>
          {isMale && (
            <ActionButton
              tone="amber"
              onClick={() => onAddWife(node.id)}
              disabled={wives >= MAX_WIVES}
              title={wives >= MAX_WIVES ? `الحد الأقصى ${MAX_WIVES} زوجات` : 'إضافة زوجة'}
            >
              <Heart className="size-3.5 sm:size-4" />
              <span className="hidden sm:inline">زوجة</span>
            </ActionButton>
          )}
          {onFocusBranch && (
            <ActionButton tone="lime" onClick={() => onFocusBranch(node.id)} title="عرض هذا الفرع فقط">
              <GitBranch className="size-3.5 sm:size-4" />
              <span className="hidden sm:inline">الفرع</span>
            </ActionButton>
          )}
          <ActionButton tone="red" wide={(Number(isMale) + Number(!!onFocusBranch)) % 2 === 0} onClick={() => setConfirmDelete(true)} disabled={isRoot} title={isRoot ? 'لا يمكن حذف المؤسس' : 'حذف'}>
            <Trash2 className="size-3.5 sm:size-4" />
            <span className="hidden sm:inline">حذف</span>
          </ActionButton>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="إغلاق"
          className="grid size-7 shrink-0 place-items-center rounded-md text-stone-500 hover:bg-amber-200/60 sm:hidden"
        >
          <X className="size-4" />
        </button>

        {childHint && <p className="basis-full rounded-md bg-amber-100 px-2 py-1 text-xs text-amber-900 sm:basis-auto">{childHint}</p>}

        {confirmDelete && !isRoot && (
          <div className="basis-full space-y-1 rounded-md border border-red-200 bg-red-50/70 p-1.5 sm:basis-auto sm:space-y-1.5 sm:p-2">
            <p className="text-xs text-red-800">
              حذف «{node.name}»{descendants > 0 ? ` مع ${descendants} من الذرية` : ''}؟ يمكنك التراجع لاحقاً.
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              <button type="button" onClick={() => onDelete(node.id)} className="h-7 rounded-md bg-red-700 text-xs font-bold text-white hover:bg-red-600 sm:h-9 sm:text-sm">
                تأكيد
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="h-7 rounded-md border border-stone-300 bg-white text-xs font-semibold hover:bg-stone-50 sm:h-9 sm:text-sm"
              >
                إلغاء
              </button>
            </div>
          </div>
        )}

        {unknownMother && (
          <form
            className="flex basis-full gap-1 sm:basis-auto sm:gap-1.5"
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
              className="h-7 min-w-0 flex-1 rounded-md border border-amber-900/25 bg-white px-1.5 text-base leading-none font-bold outline-none focus:ring-2 focus:ring-green-300 sm:h-9 sm:rounded-lg sm:px-2"
            />
            <button
              type="submit"
              disabled={!motherName.trim() || wives >= MAX_WIVES}
              title={wives >= MAX_WIVES ? `الحد الأقصى ${MAX_WIVES} زوجات` : undefined}
              className="h-7 shrink-0 rounded-md bg-amber-500 px-2 text-xs font-bold text-amber-950 hover:bg-amber-400 disabled:bg-stone-200 disabled:text-stone-400 sm:h-9 sm:rounded-lg sm:px-3"
            >
              حفظ
            </button>
          </form>
        )}

        <DetailsForm node={node} onSave={(details) => onSaveDetails(node.id, details)} />
      </div>
    </aside>
  )
}
