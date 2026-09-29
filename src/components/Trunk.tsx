import { memo } from 'react'
import { taperedBranchPath } from '../lib/geometry'

/** Lowest point of the hill at scale 1. */
export const TRUNK_DEPTH = 285
export const TRUNK_HALF_WIDTH = 380

/** Surface roots: [startX, startY, endX, endY, startWidth, endWidth]. */
const ROOTS: Array<[number, number, number, number, number, number]> = [
  [-40, 206, -210, 250, 30, 4],
  [40, 206, 215, 248, 30, 4],
  [-30, 222, -120, 262, 24, 3.5],
  [32, 222, 130, 260, 24, 3.5],
  [-8, 230, -40, 268, 20, 3],
  [12, 230, 58, 266, 18, 3],
]
const ROOT_PATHS = ROOTS.map(([sx, sy, tx, ty, w0, w1]) => taperedBranchPath(sx, sy, tx, ty, w0, w1, 14))

/** Sculpted trunk: 48px wide under the founder (y = 0), flaring to 110px at y = 240. */
const TRUNK_PATH =
  'M-24,0 C-25,50 -22,95 -27,140 C-31,178 -40,205 -55,228 C-62,236 -76,241 -92,244 L92,244 C76,241 62,236 55,228 C40,205 31,178 27,140 C22,95 25,50 24,0 Z'

const BARK_LINES = [
  'M-14,8 C-17,60 -12,110 -20,170 C-24,200 -30,218 -40,232',
  'M-3,4 C-5,50 0,100 -4,150 C-6,190 -4,215 -8,238',
  'M9,10 C8,60 13,120 10,170 C9,200 14,222 18,238',
  'M18,30 C21,80 17,130 24,175 C28,200 36,220 48,232',
  'M-20,90 C-23,115 -21,135 -25,160',
]

const GRASS = [
  'M-330,250 q4,-18 8,0', 'M-296,244 q3,-22 6,0', 'M-240,240 q4,-16 7,0', 'M-176,238 q3,-20 6,0',
  'M-110,236 q4,-15 7,0', 'M104,236 q4,-18 7,0', 'M170,238 q3,-15 6,0', 'M236,240 q4,-20 8,0',
  'M292,244 q3,-16 6,0', 'M328,250 q4,-18 7,0',
]

/** Height of the straight column above the flare; `extra` lengthens only this part. */
const COLUMN = 140

/** Moves every absolute "x,y" pair: the column stretches by `extra`, the flare below it shifts down. */
const lengthen = (d: string, extra: number) =>
  d.replace(/(-?[\d.]+),(-?[\d.]+)/g, (_, x, y) => `${x},${+y <= COLUMN ? +y * (1 + extra / COLUMN) : +y + extra}`)

/**
 * Grassy hill, spreading roots and a sculpted oak trunk under the founder. `extra` (unscaled units)
 * makes the trunk taller for a crown that hangs below the founder: only the column grows, the hill,
 * roots and flare keep their shape.
 */
function Trunk({ scale, extra = 0 }: { scale: number; extra?: number }) {
  return (
    <g className="trunk-layer" transform={`scale(${scale})`}>
      <g transform={`translate(0,${extra})`}>
      <path d="M-380,285 C-300,236 -160,220 0,220 C160,220 300,236 380,285 Z" fill="url(#hill)" />
      {ROOT_PATHS.map((d, i) => (
        <path key={i} d={d} fill="url(#woodRoot)" />
      ))}
      </g>
      <path d={lengthen(TRUNK_PATH, extra)} fill="url(#woodTrunk)" stroke="#22120a" strokeWidth={1.5} />
      {BARK_LINES.map((d, i) => (
        <path key={i} d={lengthen(d, extra)} fill="none" stroke="#1f1008" strokeOpacity={0.4} strokeWidth={1.8} strokeLinecap="round" />
      ))}
      <ellipse cx={11} cy={120 * (1 + extra / COLUMN)} rx={6} ry={9} fill="#2c1709" opacity={0.6} />
      <ellipse cx={11} cy={120 * (1 + extra / COLUMN)} rx={3} ry={5} fill="#5a3519" opacity={0.85} />
      <g transform={`translate(0,${extra})`}>
      <path d="M-380,285 C-300,262 -160,254 0,256 C160,254 300,262 380,285 Z" fill="#4f8a2f" opacity={0.85} />
      {GRASS.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="#3f7a26" strokeWidth={2.5} strokeLinecap="round" />
      ))}
      </g>
    </g>
  )
}

export default memo(Trunk)
