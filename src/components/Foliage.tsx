import { memo } from 'react'
import type { CrownBlob, LayoutNode } from '../lib/treeLayout'

/**
 * Soft green canopy behind the branches: one big leafy crown plus layered leaf clusters around every
 * card. Each layer shares a single group opacity, so overlapping circles merge into an even tone.
 */
function Foliage({ nodes, crown }: { nodes: LayoutNode[]; crown: CrownBlob[] }) {
  const leaves = nodes.filter((n) => !n.isRoot)
  return (
    <g className="foliage-layer">
      <g fill="#4d8c3a" opacity={0.16}>
        {crown.map((b, i) => (
          <circle key={i} cx={b.cx} cy={b.cy} r={b.r} />
        ))}
      </g>
      <g fill="#3f7a35" opacity={0.2}>
        {leaves.map((n) => (
          <circle key={n.id} cx={n.x} cy={n.y} r={n.type === 'wife' ? 92 : 112} />
        ))}
      </g>
      <g fill="#7fb85a" opacity={0.22}>
        {leaves.map((n) => (
          <circle key={n.id} cx={n.x - 18} cy={n.y - 24} r={n.type === 'wife' ? 58 : 74} />
        ))}
      </g>
      <g fill="#a9d57c" opacity={0.18}>
        {leaves.map((n) => (
          <circle key={n.id} cx={n.x + 26} cy={n.y - 34} r={n.type === 'wife' ? 36 : 46} />
        ))}
      </g>
    </g>
  )
}

export default memo(Foliage)
