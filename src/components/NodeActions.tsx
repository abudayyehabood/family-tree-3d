import type { ReactNode } from 'react'
import { Baby, Heart, Pencil, Trash2, UserPlus } from 'lucide-react'
import { MAX_GENERATION, MAX_WIVES } from '../model'
import type { Gender, TreeNode } from '../model'

interface NodeActionsProps {
  node: TreeNode
  isRoot: boolean
  onEditName: (id: string) => void
  onAddWife: (husbandId: string) => void
  onAddChild: (wifeId: string, gender: Gender) => void
  onDelete: (id: string) => void
}

function ActionChip({
  children,
  label,
  onClick,
  disabled,
  tone,
}: {
  children: ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  tone: string
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-bold whitespace-nowrap shadow-sm transition disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400 ${tone}`}
    >
      {children}
    </button>
  )
}

/** Quick actions shown right under the selected card: edit name, add wife/son/daughter, delete. */
export default function NodeActions({ node, isRoot, onEditName, onAddWife, onAddChild, onDelete }: NodeActionsProps) {
  const isWife = node.type === 'wife'
  const isMale = node.type === 'member' && node.gender === 'male'
  // Children hang under a wife: the wife herself, or the husband's first wife.
  const mother = isWife ? node : isMale ? node.children[0] : undefined
  const childBlocked = !mother || node.generation >= MAX_GENERATION
  const childHint = !mother
    ? isMale
      ? 'أضف زوجة أولاً'
      : 'الأنثى نهاية الفرع؛ يُضاف الأبناء تحت الأم'
    : node.generation >= MAX_GENERATION
      ? `الحد الأقصى ${MAX_GENERATION} جيلاً`
      : ''

  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-amber-900/20 bg-[#fbf6ea]/95 p-1.5 shadow-xl backdrop-blur">
      <ActionChip label="تعديل الاسم" onClick={() => onEditName(node.id)} tone="bg-[#4a2c16] text-amber-50 hover:bg-[#5c371b]">
        <Pencil className="size-3.5" />
        تعديل
      </ActionChip>
      {isMale && (
        <ActionChip
          label="إضافة زوجة جديدة"
          onClick={() => onAddWife(node.id)}
          disabled={node.children.length >= MAX_WIVES}
          tone="bg-amber-500 text-amber-950 hover:bg-amber-400"
        >
          <Heart className="size-3.5" />
          زوجة ({node.children.length}/{MAX_WIVES})
        </ActionChip>
      )}
      <ActionChip
        label={childHint || 'إضافة ابن'}
        onClick={() => mother && onAddChild(mother.id, 'male')}
        disabled={childBlocked}
        tone="bg-green-700 text-white hover:bg-green-600"
      >
        <UserPlus className="size-3.5" />
        ابن
      </ActionChip>
      <ActionChip
        label={childHint || 'إضافة بنت'}
        onClick={() => mother && onAddChild(mother.id, 'female')}
        disabled={childBlocked}
        tone="bg-pink-700 text-white hover:bg-pink-600"
      >
        <Baby className="size-3.5" />
        بنت
      </ActionChip>
      <ActionChip
        label={isRoot ? 'لا يمكن حذف المؤسس' : 'حذف'}
        onClick={() => onDelete(node.id)}
        disabled={isRoot}
        tone="bg-red-700 text-white hover:bg-red-600"
      >
        <Trash2 className="size-3.5" />
        حذف
      </ActionChip>
    </div>
  )
}
