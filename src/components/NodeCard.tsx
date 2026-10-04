import { memo } from 'react'
import type { Gender, NodeType } from '../model'
import { yearsLabel } from '../lib/tree'
import { badgeBox, COUPLE_W, MEMBER_H, MEMBER_W, WIFE_H, WIFE_W } from '../lib/treeLayout'

interface NodeCardProps {
  id: string
  type: NodeType
  gender: Gender
  name: string
  generation: number
  born?: number
  died?: number
  husband?: string
  x: number
  y: number
  isRoot: boolean
  collapsed: boolean
  childCount: number
  hiddenCount: number
  selected: boolean
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

/**
 * "+N" pill while collapsed (N hidden people), "−" disc while expanded.
 * There is no listener here: the canvas resolves taps against `badgeBox` geometry, because
 * mobile browsers retarget taps onto small clickable elements and a listener on this badge
 * ends up stealing taps aimed at the card.
 */
function ToggleBadge({ type, collapsed, hiddenCount }: { type: NodeType; collapsed: boolean; hiddenCount: number }) {
  const label = collapsed ? `+${hiddenCount}` : '−'
  const { cx, cy, hw, hh } = badgeBox(type, collapsed, hiddenCount)
  return (
    <g className="toggle-btn" data-toggle="1" transform={`translate(${cx},${cy})`}>
      <title>{collapsed ? `فتح الفرع (${hiddenCount} مخفي)` : 'طي الفرع'}</title>
      <rect
        x={-hw}
        y={-hh}
        width={hw * 2}
        height={hh * 2}
        rx={hh}
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

/** "Generation N" tag shown over the selected card. */
function GenerationTag({ generation, top }: { generation: number; top: number }) {
  return (
    <g transform={`translate(0,${top - 20})`}>
      <rect x={-34} y={-11} width={68} height={22} rx={11} fill="#14532d" stroke="#fef3c7" strokeWidth={1.5} />
      <text y={4.5} textAnchor="middle" fontSize={12} fontWeight={800} fill="#fef3c7">
        {`الجيل ${generation}`}
      </text>
    </g>
  )
}

/** Colour of a card's stand-in dot when zoomed far out: the card's own colour, so families still read. */
const dotColour = (type: NodeType, gender: Gender, isRoot: boolean) =>
  isRoot ? '#7c2d12' : type === 'wife' ? '#d97706' : gender === 'female' ? '#db2777' : '#2f6b2a'

/** Only shown far out (see `.tiny` in index.css), where a card is a few pixels and a dot reads better. */
function CardDot({ fill }: { fill: string }) {
  return <circle className="card-dot" r={70} fill={fill} stroke="#fff" strokeOpacity={0.8} strokeWidth={1} vectorEffect="non-scaling-stroke" />
}

function NodeCard(props: NodeCardProps) {
  const { id, type, gender, name, generation, born, died, husband, x, y, isRoot, collapsed, childCount, hiddenCount, selected } = props
  const years = yearsLabel(born, died)

  if (type === 'wife') {
    return (
      <g className={selected ? 'node-card is-selected' : 'node-card'} data-node-id={id} transform={`translate(${x},${y})`}>
        <CardDot fill={dotColour(type, gender, isRoot)} />
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
        <text x={-8} y={years ? 1 : 6.5} textAnchor="middle" fontSize={years ? 17 : 19} fontWeight={800} fill="#3a1d04">
          {truncate(name, 10)}
        </text>
        {years && (
          <text x={-8} y={15} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="#7c2d12">
            {years}
          </text>
        )}
        {childCount > 0 && (
          <ToggleBadge type="wife" collapsed={collapsed} hiddenCount={hiddenCount} />
        )}
        {selected && <GenerationTag generation={generation} top={-WH - 6} />}
      </g>
    )
  }

  const female = gender === 'female'

  if (female && husband) {
    // A married daughter and her husband: two wife-sized pills locked together like ∞ (hers on the right).
    const cx = COUPLE_W / 2 - WW
    return (
      <g className={selected ? 'node-card is-selected' : 'node-card'} data-node-id={id} transform={`translate(${x},${y})`}>
        <CardDot fill={dotColour(type, gender, isRoot)} />
        {selected && <rect x={-COUPLE_W / 2 - 6} y={-WH - 6} width={COUPLE_W + 12} height={WIFE_H + 12} rx={WH + 6} fill="#fde047" fillOpacity={0.5} stroke="#2563eb" strokeWidth={3} />}
        <rect x={-cx - WW} y={-WH} width={WIFE_W} height={WIFE_H} rx={WH} fill="#e0f2fe" stroke="#0369a1" strokeWidth={2} />
        <rect x={cx - WW} y={-WH} width={WIFE_W} height={WIFE_H} rx={WH} fill="url(#cardFemale)" stroke="#be185d" strokeWidth={2} />
        {/* Redraw his outline over hers, so the two rings interlock instead of one hiding the other. */}
        <path d={`M${-cx + WW - WH},${-WH} A${WH},${WH} 0 0 1 ${-cx + WW - WH},${WH}`} fill="none" stroke="#0369a1" strokeWidth={2} />
        <text x={cx + 4} y={years ? 1 : 6} textAnchor="middle" fontSize={years ? 16.5 : 18} fontWeight={800} fill="#4a0f2a">
          {truncate(name, 10)}
        </text>
        {years && (
          <text x={cx + 4} y={15} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="#831843">
            {years}
          </text>
        )}
        <text x={-cx - 4} y={6} textAnchor="middle" fontSize={17.5} fontWeight={800} fill="#0c4a6e">
          <title>{`زوجها ${husband}`}</title>
          {truncate(husband, 10)}
        </text>
        {selected && <GenerationTag generation={generation} top={-WH - 6} />}
      </g>
    )
  }

  const fill = isRoot ? 'url(#cardFounder)' : female ? 'url(#cardFemale)' : 'url(#cardMale)'
  const textColor = female && !isRoot ? '#4a0f2a' : '#ffffff'

  return (
    <g className={selected ? 'node-card is-selected' : 'node-card'} data-node-id={id} transform={`translate(${x},${y})`}>
        <CardDot fill={dotColour(type, gender, isRoot)} />
      {selected && <path d={SELECTED_LEAF} fill="#fde047" fillOpacity={0.55} stroke="#2563eb" strokeWidth={3} />}
      <path d={MEMBER_LEAF} fill={fill} stroke={isRoot ? '#f2c14e' : female ? '#be185d' : '#d9f99d'} strokeWidth={isRoot ? 3 : 2} />
      {/* Leaf vein. */}
      <path d={`M${-MW + 10},${MH - 8} Q0,${MH - 2} ${MW - 10},${-MH + 8}`} fill="none" stroke="#ffffff" strokeOpacity={0.16} strokeWidth={2} />
      <text
        x={female ? 0 : -10}
        y={years ? 0 : 7.5}
        textAnchor="middle"
        fontSize={years ? 19 : 21}
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
      {years && (
        <text x={female ? 0 : -10} y={17} textAnchor="middle" fontSize={11} fontWeight={700} fill={female && !isRoot ? '#831843' : '#ecfccb'}>
          {years}
        </text>
      )}
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
        <ToggleBadge type="member" collapsed={collapsed} hiddenCount={hiddenCount} />
      )}
      {selected && <GenerationTag generation={generation} top={-MH - 6} />}
    </g>
  )
}

export default memo(NodeCard)
