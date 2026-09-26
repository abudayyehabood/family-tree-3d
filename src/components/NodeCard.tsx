import { memo } from 'react'
import type { MouseEvent } from 'react'
import type { Gender, NodeType } from '../model'
import { MEMBER_H, MEMBER_W, WIFE_H, WIFE_W } from '../lib/treeLayout'

interface NodeCardProps {
  id: string
  type: NodeType
  gender: Gender
  name: string
  generation: number
  x: number
  y: number
  isRoot: boolean
  collapsed: boolean
  childCount: number
  hiddenCount: number
  selected: boolean
  onSelect: (id: string) => void
  onToggle: (id: string) => void
  onEdit: (id: string) => void
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

const MW = MEMBER_W / 2
const MH = MEMBER_H / 2
const WW = WIFE_W / 2
const WH = WIFE_H / 2

/** Leaf-shaped plaque: rounded on two opposite corners, pointed-ish on the others. */
const leafPath = (w: number, h: number) =>
  `M${-w},${-h + 6} Q${-w},${-h} ${-w + 6},${-h} L${w - 20},${-h} Q${w},${-h} ${w},${-h + 20} L${w},${h - 6} Q${w},${h} ${w - 6},${h} L${-w + 20},${h} Q${-w},${h} ${-w},${h - 20} Z`

const MEMBER_LEAF = leafPath(MW, MH)
const SELECTED_LEAF = leafPath(MW + 6, MH + 6)

/** "+N" pill while collapsed (N hidden people), "−" disc while expanded. */
function ToggleBadge({ collapsed, hiddenCount, onClick }: { collapsed: boolean; hiddenCount: number; onClick: (e: MouseEvent) => void }) {
  const label = collapsed ? `+${hiddenCount}` : '−'
  const w = collapsed ? 18 + label.length * 7.5 : 22
  return (
    <g className="toggle-btn" onClick={onClick} onDoubleClick={(e) => e.stopPropagation()}>
      <title>{collapsed ? `فتح الفرع (${hiddenCount} مخفي)` : 'طي الفرع'}</title>
      <rect
        x={-w / 2}
        y={-11}
        width={w}
        height={22}
        rx={11}
        fill={collapsed ? '#d97706' : '#fef3c7'}
        stroke={collapsed ? '#fff7e6' : '#92400e'}
        strokeWidth={2}
      />
      <text textAnchor="middle" y={collapsed ? 4.5 : 6} fontSize={collapsed ? 12.5 : 18} fontWeight={800} fill={collapsed ? '#fff' : '#78350f'} direction="ltr">
        {label}
      </text>
    </g>
  )
}

function NodeCard(props: NodeCardProps) {
  const { id, type, gender, name, generation, x, y, isRoot, collapsed, childCount, hiddenCount, selected, onSelect, onToggle, onEdit } = props

  const handleSelect = (e: MouseEvent) => {
    e.stopPropagation()
    onSelect(id)
  }
  const handleEdit = (e: MouseEvent) => {
    e.stopPropagation()
    onEdit(id)
  }
  const handleToggle = (e: MouseEvent) => {
    e.stopPropagation()
    onToggle(id)
  }

  if (type === 'wife') {
    return (
      <g className="node-card" transform={`translate(${x},${y})`} onClick={handleSelect} onDoubleClick={handleEdit}>
        {selected && <rect x={-WW - 6} y={-WH - 6} width={WIFE_W + 12} height={WIFE_H + 12} rx={WH + 6} fill="#fde047" fillOpacity={0.5} stroke="#2563eb" strokeWidth={3} />}
        <rect x={-WW} y={-WH} width={WIFE_W} height={WIFE_H} rx={WH} fill="url(#cardWife)" stroke="#92400e" strokeWidth={2} />
        {/* Wedding ring with a small flower on top. */}
        <g transform={`translate(${WW - 17},2)`}>
          <circle r={6} fill="none" stroke="#9a3412" strokeWidth={2} />
          <g transform="translate(0,-7)" fill="#e11d48">
            <circle cx={-2.6} r={2.2} />
            <circle cx={2.6} r={2.2} />
            <circle cy={-2.6} r={2.2} />
            <circle cy={2.6} r={2.2} />
            <circle r={1.6} fill="#fde047" />
          </g>
        </g>
        <text x={-6} y={5.5} textAnchor="middle" fontSize={15} fontWeight={800} fill="#3a1d04">
          {truncate(name, 10)}
        </text>
        {childCount > 0 && (
          <g transform={`translate(${-WW + 20},${-WH})`}>
            <ToggleBadge collapsed={collapsed} hiddenCount={hiddenCount} onClick={handleToggle} />
          </g>
        )}
      </g>
    )
  }

  const female = gender === 'female'
  const fill = isRoot ? 'url(#cardFounder)' : female ? 'url(#cardFemale)' : 'url(#cardMale)'
  const textColor = female && !isRoot ? '#4a0f2a' : '#ffffff'

  return (
    <g className="node-card" transform={`translate(${x},${y})`} onClick={handleSelect} onDoubleClick={handleEdit}>
      {selected && <path d={SELECTED_LEAF} fill="#fde047" fillOpacity={0.55} stroke="#2563eb" strokeWidth={3} />}
      <path d={MEMBER_LEAF} fill={fill} stroke={isRoot ? '#f2c14e' : female ? '#be185d' : '#d9f99d'} strokeWidth={isRoot ? 3 : 2} />
      {/* Leaf vein. */}
      <path d={`M${-MW + 10},${MH - 8} Q0,${MH - 2} ${MW - 10},${-MH + 8}`} fill="none" stroke="#ffffff" strokeOpacity={0.16} strokeWidth={2} />
      <text
        x={female ? 0 : -10}
        y={6}
        textAnchor="middle"
        fontSize={17}
        fontWeight={800}
        fill={textColor}
        stroke={female && !isRoot ? '#ffffff' : '#0b2410'}
        strokeOpacity={female && !isRoot ? 0.6 : 0.5}
        strokeWidth={3}
        paintOrder="stroke"
        strokeLinejoin="round"
      >
        {truncate(name, female ? 12 : 10)}
      </text>
      {isRoot ? (
        <g transform={`translate(0,${MH + 2})`}>
          <rect x={-30} y={-9} width={60} height={18} rx={9} fill="#7c2d12" stroke="#f2c14e" strokeWidth={1.5} />
          <text y={4.5} textAnchor="middle" fontSize={11} fontWeight={800} fill="#fef3c7">
            المؤسس
          </text>
        </g>
      ) : (
        !female && (
          <g transform={`translate(${MW - 20},0)`}>
            <title>{`الجيل ${generation}`}</title>
            <circle r={12} fill="#fef3c7" stroke="#14532d" strokeWidth={1.5} />
            <text y={4.5} textAnchor="middle" fontSize={12} fontWeight={800} fill="#14532d" direction="ltr">
              {generation}
            </text>
          </g>
        )
      )}
      {childCount > 0 && (
        <g transform={`translate(${-MW + 24},${-MH})`}>
          <ToggleBadge collapsed={collapsed} hiddenCount={hiddenCount} onClick={handleToggle} />
        </g>
      )}
    </g>
  )
}

export default memo(NodeCard)
