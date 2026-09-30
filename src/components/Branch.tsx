import { memo } from 'react'

/** Every branch is the same wood, so limbs flow into each other without a colour seam at the forks. */
export const WOOD = '#6b4423'

/**
 * The outline never scales, so even a twig of the youngest generation stays at least this many
 * screen pixels wide when the whole tree is zoomed out.
 */
export const MIN_SCREEN_WIDTH = 1.2

function Branch({ d }: { d: string }) {
  return <path d={d} fill={WOOD} stroke={WOOD} strokeWidth={MIN_SCREEN_WIDTH} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
}

export default memo(Branch)
