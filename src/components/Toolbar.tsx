import { useRef } from 'react'
import type { ReactNode } from 'react'
import { Download, FilePlus2, TreeDeciduous, Upload, Users, Zap } from 'lucide-react'
import type { TreeIndex } from '../lib/tree'
import SearchBar from './SearchBar'

interface ToolbarProps {
  index: TreeIndex
  onSearchPick: (id: string) => void
  onStress: () => void
  onDemo: () => void
  onReset: () => void
  onExport: () => void
  onImport: (file: File) => void
}

/** Icon-only on narrow screens; the Arabic labels are long and would eat half the phone. */
function ToolButton({
  icon,
  label,
  onClick,
  accent,
  desktopOnly,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  accent?: boolean
  desktopOnly?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold whitespace-nowrap transition sm:h-9 sm:px-3 sm:text-sm ${
        desktopOnly ? 'hidden sm:inline-flex' : 'inline-flex'
      } ${accent ? 'bg-amber-500 text-amber-950 hover:bg-amber-400' : 'border border-amber-100/20 bg-white/10 text-amber-50 hover:bg-white/20'}`}
    >
      {icon}
      <span className="hidden lg:inline">{label}</span>
    </button>
  )
}

export default function Toolbar({ index, onSearchPick, onStress, onDemo, onReset, onExport, onImport }: ToolbarProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  return (
    <header className="relative z-20 flex items-center gap-2 bg-gradient-to-b from-[#4a2c16] to-[#34200f] px-2 py-1.5 shadow-lg sm:gap-3 sm:px-4 sm:py-2.5">
      <div className="flex shrink-0 items-center gap-2 text-amber-50">
        <TreeDeciduous className="size-5 text-lime-300 sm:size-7" />
        <h1 className="hidden text-lg font-extrabold whitespace-nowrap md:block">شجرة العائلة</h1>
      </div>
      <SearchBar index={index} onPick={onSearchPick} />
      <div className="flex shrink-0 items-center gap-1 sm:gap-2 lg:mr-auto">
        <ToolButton desktopOnly accent icon={<Zap className="size-4" />} label="توليد 1500 شخص (15 جيل)" onClick={onStress} />
        <ToolButton icon={<Users className="size-4" />} label="عائلة تجريبية صغيرة" onClick={onDemo} />
        <ToolButton icon={<FilePlus2 className="size-4" />} label="شجرة جديدة فارغة" onClick={onReset} />
        <ToolButton icon={<Download className="size-4" />} label="تصدير JSON" onClick={onExport} />
        <ToolButton icon={<Upload className="size-4" />} label="استيراد JSON" onClick={() => fileRef.current?.click()} />
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onImport(file)
            e.target.value = ''
          }}
        />
      </div>
    </header>
  )
}
