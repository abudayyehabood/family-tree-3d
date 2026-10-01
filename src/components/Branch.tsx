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

/** Bark over a branch: shaded underside, lit ridge and dark veins, all tapering with the wood. */
export const Bark = memo(function Bark({ shade, light, veins }: { shade: string; light: string; veins: string }) {
  return (
    <>
      <path d={shade} fill="#2e1a0b" fillOpacity={0.35} />
      <path d={light} fill="#b98556" fillOpacity={0.3} />
      <path d={veins} fill="#2a1609" fillOpacity={0.55} />
    </>
  )
})

export default memo(Branch)
