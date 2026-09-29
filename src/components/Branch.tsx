import { memo } from 'react'

/** Every branch is the same wood, so limbs flow into each other without a colour seam at the forks. */
export const WOOD = '#6b4423'

function Branch({ d }: { d: string }) {
  return <path d={d} fill={WOOD} stroke="#2a1609" strokeOpacity={0.35} strokeWidth={1} />
}

export default memo(Branch)
