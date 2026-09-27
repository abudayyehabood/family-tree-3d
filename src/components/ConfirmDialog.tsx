import { useEffect } from 'react'

interface ConfirmDialogProps {
  message: string
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  return (
    // `fixed`, not `absolute`: the dialog lives inside <main>, and an overlay bounded by <main>
    // left every tree-wiping button in the toolbar clickable behind it.
    <div className="fixed inset-0 z-50 grid place-items-center bg-stone-900/40 p-4 backdrop-blur-sm" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-sm rounded-2xl border border-amber-900/20 bg-[#fbf6ea] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-5 text-sm leading-7 text-stone-800">{message}</p>
        <div className="flex gap-2">
          <button type="button" onClick={onConfirm} className="h-10 flex-1 rounded-lg bg-amber-600 text-sm font-bold text-white hover:bg-amber-500">
            متابعة
          </button>
          {/* Focus starts on «إلغاء»: every dialog here is confirming something destructive, so a
              stray Enter must not be the one that wipes the tree. */}
          <button type="button" autoFocus onClick={onCancel} className="h-10 flex-1 rounded-lg border border-stone-300 bg-white text-sm font-semibold hover:bg-stone-50">
            إلغاء
          </button>
        </div>
      </div>
    </div>
  )
}
