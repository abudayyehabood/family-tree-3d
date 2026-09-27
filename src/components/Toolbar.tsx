import { useState } from 'react'
import type { ComponentType } from 'react'
import { Download, FilePlus2, MoreHorizontal, Redo2, Search, TreeDeciduous, Undo2, Upload, Users, Zap } from 'lucide-react'
import type { TreeIndex } from '../lib/tree'
import SearchBar from './SearchBar'

interface ToolbarProps {
  index: TreeIndex
  onSearchPick: (id: string) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onStress: () => void
  onDemo: () => void
  onReset: () => void
  onExport: () => void
  onImport: (file: File) => void
}

interface Tool {
  icon: ComponentType<{ className?: string }>
  label: string
  onClick: () => void
  accent?: boolean
  /** Wipes the current tree, so it stays off the phone where it would be a thumb-width away. */
  desktopOnly?: boolean
}

/** Icon plus Arabic label from `lg` up, where there is room for it; a bare icon below that. */
function ToolButton({ tool }: { tool: Tool }) {
  const { icon: Icon, label, onClick, accent, desktopOnly } = tool
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold whitespace-nowrap transition ${
        desktopOnly ? 'hidden sm:inline-flex' : 'inline-flex'
      } ${accent ? 'bg-amber-500 text-amber-950 hover:bg-amber-400' : 'border border-amber-100/20 bg-white/10 text-amber-50 hover:bg-white/20'}`}
    >
      <Icon className="size-4" />
      <span className="hidden lg:inline">{label}</span>
    </button>
  )
}

/** One 24px round button in the phone's corner pill. */
function PillButton({
  icon: Icon,
  label,
  onClick,
  active,
  expanded,
  disabled,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  onClick: () => void
  active?: boolean
  expanded?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-expanded={expanded}
      disabled={disabled}
      className={`grid size-6 shrink-0 place-items-center rounded-full transition disabled:text-amber-50/25 ${
        active ? 'bg-amber-500 text-amber-950' : 'bg-white/10 text-amber-50 hover:bg-white/25 disabled:bg-white/5'
      }`}
    >
      <Icon className="size-3" />
    </button>
  )
}

export default function Toolbar({ index, onSearchPick, canUndo, canRedo, onUndo, onRedo, onStress, onDemo, onReset, onExport, onImport }: ToolbarProps) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  /**
   * The picker is built on the click rather than kept as a hidden input, so there is exactly one
   * of it however many layouts the toolbar renders. It has to be in the document when clicked —
   * iOS Safari ignores the click on a detached input.
   */
  const openFilePicker = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.className = 'hidden'
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (file) onImport(file)
      input.remove()
    })
    document.body.append(input)
    input.click()
  }

  const tools: Tool[] = [
    { icon: Zap, label: 'توليد 1500 شخص (15 جيل)', onClick: onStress, accent: true, desktopOnly: true },
    { icon: Users, label: 'عائلة تجريبية صغيرة', onClick: onDemo },
    { icon: FilePlus2, label: 'شجرة جديدة فارغة', onClick: onReset },
    { icon: Download, label: 'تصدير JSON', onClick: onExport },
    { icon: Upload, label: 'استيراد JSON', onClick: openFilePicker },
  ]

  return (
    <>
      <header className="relative z-20 hidden items-center gap-3 bg-gradient-to-b from-[#4a2c16] to-[#34200f] px-4 py-2.5 shadow-lg sm:flex">
        <div className="flex shrink-0 items-center gap-2 text-amber-50">
          <TreeDeciduous className="size-7 text-lime-300" />
          <h1 className="hidden text-lg font-extrabold whitespace-nowrap md:block">شجرة العائلة</h1>
        </div>
        <div className="flex min-w-0 flex-1">
          <SearchBar index={index} onPick={onSearchPick} />
        </div>
        <div className="mr-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title="تراجع (Ctrl+Z)"
            aria-label="تراجع"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-amber-100/20 bg-white/10 px-3 text-sm font-semibold text-amber-50 transition hover:bg-white/20 disabled:border-transparent disabled:bg-white/5 disabled:text-amber-50/30"
          >
            <Undo2 className="size-4" />
            <span className="hidden lg:inline">تراجع</span>
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            title="إعادة (Ctrl+Shift+Z)"
            aria-label="إعادة"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-amber-100/20 bg-white/10 px-3 text-sm font-semibold text-amber-50 transition hover:bg-white/20 disabled:border-transparent disabled:bg-white/5 disabled:text-amber-50/30"
          >
            <Redo2 className="size-4" />
            <span className="hidden lg:inline">إعادة</span>
          </button>
          <span className="h-6 w-px bg-amber-100/20" />
          {tools.map((tool) => (
            <ToolButton key={tool.label} tool={tool} />
          ))}
        </div>
      </header>

      {/*
        Phones get no top bar at all — it was stealing a band off the top of the tree for controls
        that are used once a session. Search and the file actions live in a corner pill instead,
        opposite the camera bar, and open over the canvas only when asked for.
      */}
      <div className="absolute right-1 bottom-1 z-30 flex items-center gap-px rounded-full bg-[#3b2412]/95 p-px shadow-xl sm:hidden">
        {menuOpen &&
          tools
            .filter((tool) => !tool.desktopOnly)
            .map((tool) => (
              <PillButton
                key={tool.label}
                icon={tool.icon}
                label={tool.label}
                onClick={() => {
                  setMenuOpen(false)
                  tool.onClick()
                }}
              />
            ))}
        <PillButton icon={Undo2} label="تراجع" disabled={!canUndo} onClick={onUndo} />
        <PillButton icon={Redo2} label="إعادة" disabled={!canRedo} onClick={onRedo} />
        <PillButton icon={MoreHorizontal} label="أدوات" expanded={menuOpen} active={menuOpen} onClick={() => setMenuOpen((v) => !v)} />
        <PillButton
          icon={Search}
          label="بحث"
          expanded={searchOpen}
          active={searchOpen}
          onClick={() => setSearchOpen((v) => !v)}
        />
      </div>

      {searchOpen && (
        <div className="absolute inset-x-1 bottom-9 z-30 flex sm:hidden">
          <SearchBar
            dropUp
            index={index}
            onPick={(id) => {
              onSearchPick(id)
              setSearchOpen(false)
            }}
          />
        </div>
      )}
    </>
  )
}
