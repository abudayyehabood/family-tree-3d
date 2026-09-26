import { useState } from 'react'
import type { ReactNode } from 'react'
import { Baby, Check, ChevronsDownUp, ChevronsUpDown, Crown, Heart, LocateFixed, Save, Trash2, User, UserPlus, X } from 'lucide-react'
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
  onFocus: (id: string) => void
  onToggle: (id: string) => void
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-stone-500">{label}</span>
      <span className="truncate font-semibold text-stone-800">{value}</span>
    </div>
  )
}

function ActionButton({
  children,
  onClick,
  disabled,
  tone = 'green',
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  tone?: 'green' | 'pink' | 'amber'
}) {
  const tones = {
    green: 'bg-green-700 hover:bg-green-600 text-white',
    pink: 'bg-pink-700 hover:bg-pink-600 text-white',
    amber: 'bg-amber-500 hover:bg-amber-400 text-amber-950',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex h-10 w-full items-center justify-center gap-2 rounded-lg text-sm font-bold shadow-sm transition disabled:cursor-not-allowed disabled:bg-stone-300 disabled:text-stone-500 ${tones[tone]}`}
    >
      {children}
    </button>
  )
}

export default function SidePanel({ node, index, onClose, onRename, onNameMother, onAddWife, onAddChild, onDelete, onFocus, onToggle }: SidePanelProps) {
  const [draft, setDraft] = useState(node.name)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [savedName, setSavedName] = useState(node.name)

  const entry = index.get(node.id)
  const parent = entry?.parentId ? index.get(entry.parentId)?.node : undefined
  const grandParentId = parent ? index.get(parent.id)?.parentId : null
  const grandParent = grandParentId ? index.get(grandParentId)?.node : undefined
  const descendants = entry?.descendants ?? 0
  const isRoot = !parent

  const isWife = node.type === 'wife'
  const isMale = node.type === 'member' && node.gender === 'male'
  const wives = isMale ? wifeCount(node) : 0
  const unknownMother = isMale ? node.children.find((w) => w.unknown) : undefined
  const [motherName, setMotherName] = useState('')
  const sons = isWife ? node.children.filter((c) => c.gender === 'male').length : 0
  const daughters = isWife ? node.children.length - sons : 0
  const atGenerationLimit = node.generation >= MAX_GENERATION
  const [motherId, setMotherId] = useState<string | null>(null)
  /** Children hang under a wife: the wife herself, or one of the husband's wives. */
  const mothers = isWife ? [node] : isMale ? node.children : []
  /** A man can also get children with no named mother; they go under an unknown-mother knot. */
  const offerUnknown = isMale && !unknownMother
  const mother = motherId === UNKNOWN ? undefined : (mothers.find((m) => m.id === motherId) ?? mothers[0])
  const childParentId = mother ? mother.id : offerUnknown ? node.id : undefined
  const canAddChildren = !!childParentId && !atGenerationLimit
  const childHint = atGenerationLimit
    ? `تم بلوغ الحد الأقصى للأجيال (${MAX_GENERATION})، لا يمكن إضافة أبناء.`
    : node.type === 'member' && node.gender === 'female'
      ? 'الأنثى نهاية الفرع في هذه الشجرة؛ يُضاف الأبناء تحت الأم (الزوجة).'
      : isMale && !mother
        ? 'الأم غير معروفة: يظهر الأبناء مباشرة تحت الأب، ويمكنك كتابة اسم الأم لاحقاً.'
        : null

  const title = isRoot ? 'المؤسس' : node.unknown ? 'أم غير معروفة (اكتب اسمها إن عرفته)' : isWife ? 'زوجة' : node.gender === 'male' ? 'فرد من العائلة · ذكر' : 'فرد من العائلة · أنثى'
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
      className="absolute top-3 right-3 bottom-3 z-30 flex w-[min(20rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-2xl border border-amber-900/20 bg-[#fbf6ea]/97 shadow-2xl backdrop-blur"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-3 border-b border-amber-900/10 bg-amber-100/60 px-4 py-3">
        <span className={`grid size-10 place-items-center rounded-xl ${iconTone}`}>
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-stone-500">{title}</p>
          <p className="truncate text-base font-extrabold text-stone-900">{node.name}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-lg p-1.5 text-stone-500 hover:bg-amber-200/60">
          <X className="size-5" />
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            saveName()
          }}
        >
          <label htmlFor="person-name" className="mb-1.5 block text-sm font-semibold text-stone-700">
            الاسم
          </label>
          <input
            id="person-name"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => e.target.select()}
            className="h-12 w-full rounded-lg border-2 border-green-700/40 bg-white px-3 text-lg font-extrabold text-stone-900 outline-none focus:border-green-600 focus:ring-2 focus:ring-green-300"
          />
          <button
            type="submit"
            disabled={!trimmed || !dirty}
            className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-green-700 text-base font-bold text-white shadow transition hover:bg-green-600 disabled:bg-stone-200 disabled:text-stone-500"
          >
            {dirty || !trimmed ? <Save className="size-4" /> : <Check className="size-4" />}
            {dirty || !trimmed ? 'حفظ الاسم' : 'محفوظ'}
          </button>
          <p className="mt-1.5 text-xs text-stone-500">اضغط Enter للحفظ، أو انقر نقراً مزدوجاً على أي بطاقة في الشجرة لتعديل اسمها مباشرة.</p>
        </form>

        <div className="divide-y divide-amber-900/10 rounded-xl border border-amber-900/10 bg-white/70 px-3">
          <InfoRow label="الجيل" value={`${node.generation} من ${MAX_GENERATION}`} />
          {isWife && parent && <InfoRow label="الزوج" value={parent.name} />}
          {!isWife && parent && <InfoRow label="الأم" value={parent.name} />}
          {!isWife && grandParent && <InfoRow label="الأب" value={grandParent.name} />}
          {isMale && <InfoRow label="الزوجات" value={`${wives} من ${MAX_WIVES}`} />}
          {isWife && <InfoRow label="الأبناء" value={`${sons} ابن · ${daughters} بنت`} />}
          <InfoRow label="إجمالي الذرية" value={descendants} />
        </div>

        <div className="space-y-2">
          {isMale && (
            <ActionButton tone="amber" onClick={() => onAddWife(node.id)} disabled={wives >= MAX_WIVES}>
              <Heart className="size-4" />
              إضافة زوجة جديدة ({wives} / {MAX_WIVES})
            </ActionButton>
          )}
          <div className="space-y-2 rounded-xl border border-green-800/15 bg-green-50/60 p-3">
            <p className="text-sm font-bold text-stone-800">إضافة الأبناء</p>
            {isMale && (mothers.length > 0 || offerUnknown) && (
              <label className="block text-xs text-stone-600">
                الأم
                <select
                  value={mother?.id ?? UNKNOWN}
                  onChange={(e) => setMotherId(e.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-amber-900/25 bg-white px-2 text-sm font-bold text-stone-900 outline-none focus:ring-2 focus:ring-green-300"
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
            <div className="grid grid-cols-2 gap-2">
              <ActionButton tone="green" onClick={() => childParentId && onAddChild(childParentId, 'male')} disabled={!canAddChildren}>
                <UserPlus className="size-4" />
                إضافة ابن (ذكر)
              </ActionButton>
              <ActionButton tone="pink" onClick={() => childParentId && onAddChild(childParentId, 'female')} disabled={!canAddChildren}>
                <Baby className="size-4" />
                إضافة بنت (أنثى)
              </ActionButton>
            </div>
            {unknownMother && (
              <form
                className="space-y-1.5 rounded-lg border border-amber-900/15 bg-white/80 p-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (motherName.trim()) onNameMother(node.id, motherName.trim())
                }}
              >
                <label htmlFor="mother-name" className="block text-xs text-stone-600">
                  أم الأبناء غير معروفة ({unknownMother.children.length}). اكتب اسمها إن عرفته:
                </label>
                <div className="flex gap-1.5">
                  <input
                    id="mother-name"
                    value={motherName}
                    onChange={(e) => setMotherName(e.target.value)}
                    placeholder="اسم الأم"
                    className="h-9 min-w-0 flex-1 rounded-lg border border-amber-900/25 bg-white px-2 text-sm font-bold outline-none focus:ring-2 focus:ring-green-300"
                  />
                  <button
                    type="submit"
                    disabled={!motherName.trim() || wives >= MAX_WIVES}
                    title={wives >= MAX_WIVES ? `الحد الأقصى ${MAX_WIVES} زوجات` : undefined}
                    className="h-9 rounded-lg bg-amber-500 px-3 text-xs font-bold text-amber-950 hover:bg-amber-400 disabled:bg-stone-200 disabled:text-stone-400"
                  >
                    حفظ
                  </button>
                </div>
              </form>
            )}
            {childHint && <p className="rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900">{childHint}</p>}
          </div>
          {node.children.length > 0 && (
            <button
              type="button"
              onClick={() => onToggle(node.id)}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-amber-900/20 bg-white text-sm font-semibold text-stone-700 hover:bg-amber-50"
            >
              {node.collapsed ? <ChevronsUpDown className="size-4" /> : <ChevronsDownUp className="size-4" />}
              طي / فتح الفرع {node.collapsed ? `(+${descendants} مخفي)` : ''}
            </button>
          )}
          <button
            type="button"
            onClick={() => onFocus(node.id)}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-amber-900/20 bg-white text-sm font-semibold text-stone-700 hover:bg-amber-50"
          >
            <LocateFixed className="size-4" />
            التمركز على الشخص
          </button>
        </div>
      </div>

      <div className="border-t border-amber-900/10 p-4">
        {confirmDelete && !isRoot ? (
          <div className="space-y-2">
            <p className="text-center text-xs text-red-800">
              سيتم حذف «{node.name}»{descendants > 0 ? ` مع ${descendants} من الذرية` : ''}. لا يمكن التراجع.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => onDelete(node.id)} className="h-10 rounded-lg bg-red-700 text-sm font-bold text-white hover:bg-red-600">
                تأكيد الحذف
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="h-10 rounded-lg border border-stone-300 bg-white text-sm font-semibold hover:bg-stone-50">
                إلغاء
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={isRoot}
            title={isRoot ? 'لا يمكن حذف المؤسس' : undefined}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-red-300 bg-red-50 text-sm font-bold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:border-stone-200 disabled:bg-stone-100 disabled:text-stone-400"
          >
            <Trash2 className="size-4" />
            حذف
          </button>
        )}
      </div>
    </aside>
  )
}
