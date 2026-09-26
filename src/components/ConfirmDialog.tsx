interface ConfirmDialogProps {
  message: string
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-stone-900/40 p-4 backdrop-blur-sm" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-sm rounded-2xl border border-amber-900/20 bg-[#fbf6ea] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-5 text-sm leading-7 text-stone-800">{message}</p>
        <div className="flex gap-2">
          <button type="button" autoFocus onClick={onConfirm} className="h-10 flex-1 rounded-lg bg-amber-600 text-sm font-bold text-white hover:bg-amber-500">
            متابعة
          </button>
          <button type="button" onClick={onCancel} className="h-10 flex-1 rounded-lg border border-stone-300 bg-white text-sm font-semibold hover:bg-stone-50">
            إلغاء
          </button>
        </div>
      </div>
    </div>
  )
}
