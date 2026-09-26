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

function ToolButton({ icon, label, onClick, accent }: { icon: ReactNode; label: string; onClick: () => void; accent?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold whitespace-nowrap transition ${
        accent
          ? 'bg-amber-500 text-amber-950 hover:bg-amber-400'
          : 'border border-amber-100/20 bg-white/10 text-amber-50 hover:bg-white/20'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

export default function Toolbar({ index, onSearchPick, onStress, onDemo, onReset, onExport, onImport }: ToolbarProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  return (
    <header className="relative z-20 flex flex-wrap items-center gap-3 bg-gradient-to-b from-[#4a2c16] to-[#34200f] px-4 py-2.5 shadow-lg">
      <div className="flex items-center gap-2 text-amber-50">
        <TreeDeciduous className="size-7 text-lime-300" />
        <h1 className="text-lg font-extrabold whitespace-nowrap">شجرة العائلة</h1>
      </div>
      <SearchBar index={index} onPick={onSearchPick} />
      <div className="flex flex-wrap items-center gap-2 lg:mr-auto">
        <ToolButton accent icon={<Zap className="size-4" />} label="توليد 1500 شخص (15 جيل)" onClick={onStress} />
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
