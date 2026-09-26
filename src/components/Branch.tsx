import { memo } from 'react'

interface BranchProps {
  d: string
  kind: 'wife' | 'child'
}

/** Wife branches carry a warm golden-wood tint; child branches run from rich wood to olive. */
function Branch({ d, kind }: BranchProps) {
  return <path d={d} fill={kind === 'wife' ? 'url(#branchWife)' : 'url(#branchChild)'} stroke="#2a1609" strokeOpacity={0.35} strokeWidth={1} />
}

export default memo(Branch)
