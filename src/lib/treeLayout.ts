import { hierarchy, tree } from 'd3-hierarchy'
import type { HierarchyNode, HierarchyPointNode } from 'd3-hierarchy'
import type { Gender, NodeType, TreeNode } from '../model'
import { taperedPolylinePath } from './geometry'
import type { Point } from './geometry'
import type { TreeIndex } from './tree'

export const MEMBER_W = 130
export const MEMBER_H = 46
export const WIFE_W = 115
export const WIFE_H = 38
/** A married daughter is two wife-sized pills (hers and her husband's) overlapping like ∞. */
export const COUPLE_OVERLAP = 14
export const COUPLE_W = 2 * WIFE_W - COUPLE_OVERLAP

/** Collapse badge: 22 world units tall, anchored on the card's top leading corner. */
const BADGE_H = 22
const BADGE_MIN_W = 22

/** Half-extents of a card, in world units. */
export function cardHalf(type: NodeType, husband = false): { hw: number; hh: number } {
  if (type === 'wife') return { hw: WIFE_W / 2, hh: WIFE_H / 2 }
  if (husband) return { hw: COUPLE_W / 2, hh: WIFE_H / 2 }
  return { hw: MEMBER_W / 2, hh: MEMBER_H / 2 }
}

/** The collapse badge's box relative to the card centre, in world units. */
export function badgeBox(type: NodeType, collapsed: boolean, hiddenCount: number): { cx: number; cy: number; hw: number; hh: number } {
  const label = collapsed ? `+${hiddenCount}` : '−'
  const w = collapsed ? 18 + label.length * 7.5 : BADGE_MIN_W
  const { hw, hh } = cardHalf(type)
  return { cx: -hw + (type === 'wife' ? 20 : 24), cy: -hh, hw: w / 2, hh: BADGE_H / 2 }
}

/**
 * What a tap at world point (wx, wy) hits.
 *
 * Done by geometry rather than by reading the event target: both Safari and Chromium apply
 * fat-finger "touch adjustment" that silently retargets a tap onto the nearest small clickable
 * element, and at the zoom that fits a whole tree on a phone a card is ~36px wide while its
 * collapse badge is ~6px — so taps meant for a card were being stolen by the badge.
 *
 * `pad` (world units) widens the card boxes so small cards stay easy to hit; the badge is never
 * padded, so it only wins on a deliberate hit and the card wins in every ambiguous case.
 */
export function hitTest(nodes: LayoutNode[], wx: number, wy: number, pad: number): { node: LayoutNode; badge: boolean } | null {
  let best: LayoutNode | null = null
  let bestDistance = Infinity
  for (const n of nodes) {
    const { hw, hh } = cardHalf(n.type, !!n.husband)
    const dx = Math.abs(wx - n.x)
    const dy = Math.abs(wy - n.y)
    if (dx > hw + pad || dy > hh + pad) continue
    // Nearest centre wins, so padded boxes overlapping each other stay predictable.
    const distance = (dx / (hw + pad)) ** 2 + (dy / (hh + pad)) ** 2
    if (distance < bestDistance) {
      bestDistance = distance
      best = n
    }
  }
  if (!best) return null
  if (best.childCount > 0) {
    const b = badgeBox(best.type, best.collapsed, best.hiddenCount)
    if (Math.abs(wx - (best.x + b.cx)) <= b.hw && Math.abs(wy - (best.y + b.cy)) <= b.hh) return { node: best, badge: true }
  }
  return { node: best, badge: false }
}

/** Husband → wife: short branch. */
export const WIFE_STEP = 85
/** Mother → child: slightly longer branch. */
export const CHILD_STEP = 140

/** Extra room around each card in the collision test (the +/− badge pokes out of the top edge). */
const PAD_X = 8
const PAD_Y = 12
/** Neighbours with different parents keep this much more room than siblings. */
const COUSIN_PAD = 24

const DEG = Math.PI / 180
/**
 * The founder sits on the trunk top and generations fan out above him, up to 100° either side of
 * straight up. Rings are bent into a dome (full radius straight up, pulled in towards the flanks), so
 * the crown is round like an oak instead of a flat fan.
 */
const MAX_THETA = 100 * DEG
/** 1 = plain circles around the founder, 0 = circles through the founder. */
const DOME = 0.7
const dome = (theta: number) => DOME + (1 - DOME) * Math.cos(theta)
/** Screen point at ring radius r and angle θ (0 = straight up, positive = to the right). */
const toPoint = (r: number, theta: number): Point => [r * dome(theta) * Math.sin(theta), -r * dome(theta) * Math.cos(theta)]
/** A narrow tree is stretched to fill the fan, but never more than this (small families stay upright). */
const MAX_STRETCH = 2
/**
 * The tidy tree may be squeezed to this fraction of its natural width to fit inside the fan; each ring
 * is then relaxed so cards keep their gap. Lower = denser crown but children drift from their parents.
 */
const MIN_SQUEEZE = 0.5
/** A ring is only allowed to be this full before it is pushed outward (room for the tidy tree's slack). */
const RING_FILL = 0.6
/** Radial room added between two rings whose cards touch. */
const RING_BUMP = 16
/**
 * Radial distance between the two staggered rows of a crowded generation, near the top of the crown.
 * (More rows gain nothing: a branch to an outer row must still pass between the inner-row cards.)
 */
const LANE_STEP = MEMBER_H + PAD_Y + 10
const MAX_ATTEMPTS = 120

/** Branch width: the trunk top for the founder, then this factor thinner every generation. */
const TRUNK_TOP = 48
const TAPER = 0.82
const MIN_LIMB = 3
/** A generation's ring sits at least this many of its limb widths beyond the one before. */
const LIMB_LENGTH = 2.5
/** Radial room a limb gets per unit of sideways travel, so a far-turning limb climbs instead of wrapping. */
const TURN_SLOPE = 0.4
/** Turns up to this angle sweep fine inside the normal gap between two rings. */
const FREE_TURN = 40 * DEG
/** …but never more than this per ring, or rings whose limbs all turn far would push the crown out without end. */
const MAX_TURN_ROOM = 500

/** Points sampled along each branch's polar sweep. */
const BRANCH_SAMPLES = 16

export interface LayoutNode {
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
  /** People hidden under this node while it is collapsed (0 when expanded). */
  hiddenCount: number
}

export interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface LayoutLink {
  id: string
  d: string
  kind: 'wife' | 'child'
  /** Bounding box of the branch (Bézier hull), used for viewport culling. */
  box: Box
}

export interface CrownBlob {
  cx: number
  cy: number
  r: number
}

export interface TreeLayout {
  nodes: LayoutNode[]
  links: LayoutLink[]
  byId: Map<string, LayoutNode>
  bounds: Box
  /** Big leafy silhouette drawn behind the whole canopy. */
  crown: CrownBlob[]
  /** Trunk scale (1 for normal families, grows for huge crowns so the trunk stays proportional). */
  trunkScale: number
}

type Placed = HierarchyPointNode<TreeNode>

interface Polar {
  r: number
  theta: number
  x: number
  y: number
  w: number
  h: number
}

const cardW = (n: TreeNode) => (n.unknown ? 0 : 2 * cardHalf(n.type, !!n.husband).hw)
const cardH = (n: TreeNode) => (n.unknown ? 0 : 2 * cardHalf(n.type, !!n.husband).hh)

/** Width of every branch of one generation (the founder's equals the trunk top). */
const limbWidth = (generation: number, trunkScale: number) => Math.max(MIN_LIMB, TRUNK_TOP * trunkScale * TAPER ** (generation - 1))

function collides(a: Polar, b: Polar): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + PAD_X && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + PAD_Y
}

/**
 * For every depth whose cards touch a card further in, how far that ring must move out to clear it
 * (along the outer card's radius). Touching cards of one ring go to `sameRing` instead. Uses a coarse
 * grid so large trees stay fast.
 */
function findCollisions(all: HierarchyNode<TreeNode>[], polar: Map<string, Polar>, sameRing: Array<[string, string]>): Map<number, number> {
  const CELL = 250
  const grid = new Map<string, Array<{ p: Polar; depth: number; id: string }>>()
  const result = new Map<number, number>()
  for (const n of all) {
    const p = polar.get(n.data.id)!
    if (!p.w) continue
    const cx = Math.floor(p.x / CELL)
    const cy = Math.floor(p.y / CELL)
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cy - 1; j <= cy + 1; j++) {
        for (const q of grid.get(`${i},${j}`) ?? []) {
          if (!collides(p, q.p)) continue
          if (q.depth === n.depth) {
            sameRing.push([n.data.id, q.id])
            continue
          }
          const [outer, inner, depth] = p.r >= q.p.r ? [p, q.p, n.depth] : [q.p, p, q.depth]
          const W = (outer.w + inner.w) / 2 + PAD_X - Math.abs(outer.x - inner.x)
          const H = (outer.h + inner.h) / 2 + PAD_Y - Math.abs(outer.y - inner.y)
          const s = Math.abs(Math.sin(outer.theta))
          const c = Math.abs(Math.cos(outer.theta))
          const need = Math.min(s > 1e-3 ? W / s : Infinity, c > 1e-3 ? H / c : Infinity) + 1
          result.set(depth, Math.max(result.get(depth) ?? 0, Math.min(need, RING_BUMP * 20)))
        }
      }
    }
    const key = `${cx},${cy}`
    const cell = grid.get(key)
    if (cell) cell.push({ p, depth: n.depth, id: n.data.id })
    else grid.set(key, [{ p, depth: n.depth, id: n.data.id }])
  }
  return result
}

/**
 * Spreads a ring so neighbour k and k+1 are at least `gaps[k]` apart and the ring stays inside the fan,
 * moving the cards as little as possible (least squares), so no child slides far from its parent.
 * `thetas` must be sorted ascending.
 *
 * With u[i] = t[i] − (gaps[0] + … + gaps[i-1]) the gap rule becomes "u never decreases", which
 * pool-adjacent-violators solves exactly: runs that break the order are merged into their mean.
 */
function relaxAngles(thetas: number[], gaps: number[]): number[] {
  const offset = [0]
  for (const g of gaps) offset.push(offset[offset.length - 1] + g)
  const pools: Array<{ mean: number; count: number }> = []
  thetas.forEach((t, i) => {
    let mean = t - offset[i]
    let count = 1
    while (pools.length && pools[pools.length - 1].mean > mean) {
      const prev = pools.pop()!
      mean = (mean * count + prev.mean * prev.count) / (count + prev.count)
      count += prev.count
    }
    pools.push({ mean, count })
  })
  const hi = MAX_THETA - offset[offset.length - 1]
  const out: number[] = []
  for (const { mean, count } of pools) {
    const u = Math.min(hi, Math.max(-MAX_THETA, mean))
    for (let k = 0; k < count; k++) out.push(u + offset[out.length])
  }
  return out
}

/**
 * Round crown above the founder.
 * Every depth is a domed ring around him. d3.tree() works directly in angles, and the gap it keeps between
 * two neighbours is what their real card sizes need at that spot of the ring: full width at the top,
 * only card height on the flanks. Each ring sits as close to the one inside it as its own
 * crowd and limb thickness allow, so only crowded outer rings are pushed out, and those get a second
 * staggered row before they grow.
 */
export function computeLayout(data: TreeNode, index: TreeIndex): TreeLayout {
  const root = hierarchy(data, (d) => (d.collapsed ? null : d.children))
  const all = root.descendants()

  const levels: Placed[][] = []
  for (const n of all) (levels[n.depth] ??= []).push(n as Placed)
  /** Position among the visible cards of its ring, left to right (picks the row). */
  const laneIndex = new Map<string, number>()
  for (const ring of levels) ring.filter((n) => !n.data.unknown).forEach((n, k) => laneIndex.set(n.data.id, k))
  const step = levels.map((ring, depth) => {
    const cards = ring.filter((n) => !n.data.unknown)
    if (!depth || !cards.length) return 0
    return cards[0].data.type === 'wife' ? WIFE_STEP : CHILD_STEP
  })
  /** Radial room added in front of each ring on top of its step. */
  const extra = levels.map(() => 0)
  const radius: number[] = []
  /** Rows per ring: 2 for crowded generations. */
  const lanes = levels.map(() => 1)
  /** How far each ring's outermost row sits beyond the ring (grows where rows touch). */
  const laneSpread = levels.map(() => 0)
  /** Extra factor on the gap after a card (d3 order), grown where two cards of one ring still touch. */
  const boost = new Map<string, number>()
  const ringOrder = levels.map((ring) => ring.filter((n) => !n.data.unknown).map((n) => n.data.id))
  /** Thick limbs need length to read as limbs rather than knots: a ring sits at least a few limb widths out. */
  const limbStep = (d: number) => (d && step[d] === CHILD_STEP ? Math.max(CHILD_STEP, LIMB_LENGTH * limbWidth(levels[d][0].data.generation, trunkScale)) : step[d])
  const placeRings = () => levels.forEach((_, d) => (radius[d] = d ? radius[d - 1] + laneSpread[d - 1] + limbStep(d) + extra[d] : 0))
  /** Radial distance between two rows at angle θ: stacked vertically near the top, side by side on the steep flanks. */
  const laneStep = (theta: number) =>
    Math.min(LANE_STEP / Math.max(Math.abs(Math.cos(theta)), 1e-3), (MEMBER_W + PAD_X) / Math.max(Math.abs(Math.sin(theta)), 1e-3))

  let trunkScale = 1
  /** Angle of every card in the previous attempt (the gap two cards need depends on where they sit). */
  const lastTheta = new Map<string, number>()
  /** Straight-line distance two neighbours need, given their angle on the ring. */
  const pairDistance = (a: HierarchyNode<TreeNode>, b: HierarchyNode<TreeNode>) => {
    const theta = ((lastTheta.get(a.data.id) ?? 0) + (lastTheta.get(b.data.id) ?? 0)) / 2
    const w = (cardW(a.data) + cardW(b.data)) / 2 + PAD_X + (a.parent === b.parent ? 0 : COUSIN_PAD)
    const h = (cardH(a.data) + cardH(b.data)) / 2 + PAD_Y
    // Neighbours sit along the ring's tangent (cos θ, sin θ): clear either sideways or vertically.
    const card = Math.min(w / Math.max(Math.abs(Math.cos(theta)), 1e-3), h / Math.max(Math.abs(Math.sin(theta)), 1e-3))
    // Branches of different families must not merge (siblings may: they fork from one limb anyway).
    const limbs = a.parent === b.parent ? 0 : (limbWidth(a.data.generation, trunkScale) + limbWidth(b.data.generation, trunkScale)) / 2 + PAD_X
    // +2: float slack, so neighbours packed exactly to the gap never read as touching.
    return Math.max(card, limbs) + 2
  }
  const pairAngle = (a: HierarchyNode<TreeNode>, b: HierarchyNode<TreeNode>) => {
    const r = radius[a.depth] * dome(((lastTheta.get(a.data.id) ?? 0) + (lastTheta.get(b.data.id) ?? 0)) / 2) || 1
    return 2 * Math.asin(Math.min(1, pairDistance(a, b) / (2 * r)))
  }
  /**
   * Gap between neighbours when their ring has two rows: half the usual, but never so tight that the
   * branch to an outer-row card can't pass cleanly between the inner-row cards beside it.
   */
  const laneGap = (a: HierarchyNode<TreeNode>, b: HierarchyNode<TreeNode>) => {
    const full = pairAngle(a, b)
    if (lanes[a.depth] < 2) return full
    const r = radius[a.depth] * dome(lastTheta.get(a.data.id) ?? 0) || 1
    const pass = (Math.max(cardW(a.data), cardW(b.data)) / 2 + limbWidth(a.data.generation + 1, trunkScale) / 2 + PAD_X) / r
    return Math.min(full, Math.max(full / 2, pass))
  }
  const layoutTree = tree<TreeNode>().nodeSize([1, 1]).separation(laneGap)

  let polar = new Map<string, Polar>()
  let outerRadius = 0
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    placeRings()
    // Push out every ring that could not hold its cards inside the fan even if packed tight.
    levels.forEach((level, d) => {
      const cards = level.filter((n) => !n.data.unknown && n.parent)
      let need = 0
      for (let k = 1; k < cards.length; k++) need += pairAngle(cards[k - 1], cards[k])
      const ratio = need / (2 * MAX_THETA * RING_FILL)
      if (ratio > 1 && lanes[d] === 1) {
        lanes[d] = 2
        laneSpread[d] = Math.max(laneSpread[d], LANE_STEP)
        placeRings()
      }
      if (ratio > lanes[d]) {
        extra[d] += radius[d] * (ratio / lanes[d] - 1)
        placeRings()
      }
    })

    layoutTree(root)
    let minX = Infinity
    let maxX = -Infinity
    for (const n of all) {
      minX = Math.min(minX, n.x!)
      maxX = Math.max(maxX, n.x!)
    }
    const span = maxX - minX
    const mid = (minX + maxX) / 2
    // Squeeze into the fan (the rings are then relaxed below), or stretch a narrow tree to fill it.
    const fit = span > 0 ? Math.min(MAX_STRETCH, Math.max(MIN_SQUEEZE, (2 * MAX_THETA) / span)) : 1
    // Mirrored: the first-born (smallest d3 x) sits on the right, matching Arabic reading order.
    const toTheta = (x: number) => -(x - mid) * fit

    const thetas = new Map<string, number>()
    const crowded: number[] = []
    levels.forEach((level, depth) => {
      // Ascending angle = reverse d3 order.
      const cards = level.filter((n) => !n.data.unknown && n.parent).reverse()
      if (!cards.length) return
      const gaps = cards.slice(1).map((n, k) => laneGap(cards[k], n) * (boost.get(n.data.id) ?? 1))
      if (gaps.reduce((s, g) => s + g, 0) > 2 * MAX_THETA) crowded.push(depth)
      const relaxed = relaxAngles(
        cards.map((n) => toTheta(n.x!)),
        gaps,
      )
      cards.forEach((n, k) => thetas.set(n.data.id, relaxed[k]))
    })

    polar = new Map()
    outerRadius = 0
    const spread = levels.map(() => 0)
    for (const n of all) {
      const d = n.data
      if (!n.parent) {
        polar.set(d.id, { r: 0, theta: 0, x: 0, y: 0, w: MEMBER_W, h: MEMBER_H })
        continue
      }
      // An unknown mother sits on her husband; her children grow straight out of him.
      if (d.unknown) {
        polar.set(d.id, { ...polar.get(n.parent.data.id)!, w: 0, h: 0 })
        continue
      }
      const theta = thetas.get(d.id)!
      const row = (laneIndex.get(d.id) ?? 0) % lanes[n.depth]
      const r = radius[n.depth] + row * laneStep(theta)
      spread[n.depth] = Math.max(spread[n.depth], r - radius[n.depth])
      const [x, y] = toPoint(r, theta)
      polar.set(d.id, { r, theta, x, y, w: cardW(d), h: cardH(d) })
      outerRadius = Math.max(outerRadius, r)
    }

    // The gaps above used last attempt's angles and trunk: settle them before judging collisions.
    let moved = false
    for (const [id, t] of thetas) {
      if (Math.abs((lastTheta.get(id) ?? 99) - t) > 2 * DEG) moved = true
      lastTheta.set(id, t)
    }
    const nextTrunk = Math.min(9, Math.max(1, outerRadius / 800))
    if (Math.abs(nextTrunk - trunkScale) > 0.05) moved = true
    trunkScale = nextTrunk

    for (const d of crowded) extra[d] += RING_BUMP
    // A limb that must turn far needs radial room to do it, or it wraps along the ring like an arch.
    const turnRoom = levels.map(() => 0)
    for (const n of all) {
      const from = n.parent?.data.unknown ? n.parent.parent : n.parent
      if (!from?.parent || n.data.unknown) continue
      const a = polar.get(from.data.id)!
      const b = polar.get(n.data.id)!
      turnRoom[n.depth] = Math.max(turnRoom[n.depth], Math.min(MAX_TURN_ROOM, a.r * Math.max(0, Math.abs(b.theta - a.theta) - FREE_TURN) * TURN_SLOPE))
    }
    turnRoom.forEach((need, d) => {
      const room = limbStep(d) + extra[d]
      if (need > room + 1) {
        extra[d] += need - room
        moved = true
      }
    })
    spread.forEach((v, d) => {
      if (Math.abs(v - laneSpread[d]) > 1) moved = true
      laneSpread[d] = v
    })
    const sameRing: Array<[string, string]> = []
    const clash = findCollisions(all, polar, sameRing)
    for (const [a, b] of sameRing) {
      const order = ringOrder.find((ids) => ids.includes(a))!
      const [i, j] = [order.indexOf(a), order.indexOf(b)].sort((x, y) => x - y)
      for (let k = i; k < j; k++) boost.set(order[k], Math.min(4, (boost.get(order[k]) ?? 1) * 1.15))
    }
    for (const [d, need] of clash) extra[d] += need
    if (!crowded.length && !clash.size && !sameRing.length && !moved) break
  }

  /** Innermost and outermost card radius of every ring. */
  const ringInner: number[] = []
  const ringOuter: number[] = []
  for (const n of all) {
    const p = polar.get(n.data.id)!
    if (!p.w && n.parent) continue
    ringInner[n.depth] = Math.min(ringInner[n.depth] ?? Infinity, p.r)
    ringOuter[n.depth] = Math.max(ringOuter[n.depth] ?? -Infinity, p.r)
  }

  const nodes: LayoutNode[] = []
  const links: LayoutLink[] = []
  const byId = new Map<string, LayoutNode>()
  const bounds: Box = { minX: -MEMBER_W / 2, maxX: MEMBER_W / 2, minY: -MEMBER_H / 2, maxY: MEMBER_H / 2 }

  for (const n of all) {
    const d = n.data
    const p = polar.get(d.id)!
    const collapsed = !!d.collapsed && d.children.length > 0
    const node: LayoutNode = {
      id: d.id,
      type: d.type,
      gender: d.gender,
      name: d.name,
      generation: d.generation,
      born: d.born,
      died: d.died,
      husband: d.husband,
      x: p.x,
      y: p.y,
      // Only the real founder; in branch-focus mode the focused person is drawn as a normal card.
      isRoot: !n.parent && !index.get(d.id)?.parentId,
      collapsed,
      childCount: d.children.length,
      hiddenCount: collapsed ? (index.get(d.id)?.descendants ?? 0) : 0,
    }
    // Unknown mothers are invisible: no card, no branch of their own.
    if (d.unknown) continue
    nodes.push(node)
    byId.set(d.id, node)
    bounds.minX = Math.min(bounds.minX, p.x - p.w / 2 - PAD_X)
    bounds.maxX = Math.max(bounds.maxX, p.x + p.w / 2 + PAD_X)
    bounds.minY = Math.min(bounds.minY, p.y - p.h / 2 - PAD_Y)
    bounds.maxY = Math.max(bounds.maxY, p.y + p.h / 2)

    if (!n.parent) continue
    // A child of an unknown mother branches straight from the father.
    const from = n.parent.data.unknown ? n.parent.parent! : n.parent
    // The founder's limbs leave the trunk top straight towards their child.
    const pp = from.parent ? polar.get(from.data.id)! : { ...polar.get(from.data.id)!, theta: p.theta }
    /*
     * The branch is swept in polar space: it leaves the parent along its radius, and the angle eases
     * from the parent's to the child's only inside the gap between the two rings. Every branch
     * across one gap turns over the same radii, so neighbouring branches keep their order and never
     * cross.
     */
    const gapStart = Math.min(ringOuter[from.depth], p.r)
    const gapEnd = Math.max(gapStart + 1, ringInner[n.depth])
    const centre: Point[] = []
    // A sweep near the founder would wrap round him like an arch: his and his wives' limbs run straight,
    // and limbs that start close in (compared with where they end) straighten partly, like real limbs.
    const straight = from.depth <= 1 ? 1 : Math.min(1, Math.max(0, (1 - pp.r / p.r) * 1.5 - 0.2))
    const add = (r: number) => {
      const u = Math.min(1, Math.max(0, (r - gapStart) / (gapEnd - gapStart)))
      const theta = pp.theta + (p.theta - pp.theta) * (u * u * (3 - 2 * u))
      const [sx, sy] = toPoint(r, theta)
      const t = (r - pp.r) / (p.r - pp.r || 1)
      centre.push([sx + (pp.x + (p.x - pp.x) * t - sx) * straight, sy + (pp.y + (p.y - pp.y) * t - sy) * straight])
    }
    if (pp.r < gapStart) add(pp.r)
    for (let i = 0; i <= BRANCH_SAMPLES; i++) add(gapStart + ((gapEnd - gapStart) * i) / BRANCH_SAMPLES)
    if (p.r > gapEnd) add(p.r)

    // Harmonic widths: a branch starts at its parent's generation width and ends at the child's.
    const w0 = limbWidth(from.data.generation, trunkScale)
    const w1 = limbWidth(d.generation, trunkScale)
    const pad = w0 / 2
    const xs = centre.map((q) => q[0])
    const ys = centre.map((q) => q[1])
    links.push({
      id: d.id,
      d: taperedPolylinePath(centre, w0, w1),
      kind: d.type === 'wife' ? 'wife' : 'child',
      box: {
        minX: Math.min(...xs) - pad,
        minY: Math.min(...ys) - pad,
        maxX: Math.max(...xs) + pad,
        maxY: Math.max(...ys) + pad,
      },
    })
  }

  return { nodes, links, byId, bounds, crown: crownBlobs(outerRadius), trunkScale }
}

/** A rounded leafy crown: large overlapping circles covering the whole canopy. */
function crownBlobs(outer: number): CrownBlob[] {
  const R = Math.max(outer, 260)
  const [cx, cy] = toPoint(R * 0.5 * Math.max(0, Math.cos(MAX_THETA / 2)), 0)
  const blobs: CrownBlob[] = [{ cx, cy, r: R * 0.55 }]
  const steps = 10
  for (let i = 0; i <= steps; i++) {
    // Blobs stop short of hanging below the founder, so none sinks under the ground.
    const a = Math.min(MAX_THETA * 0.85, 105 * DEG) * (-1 + (2 * i) / steps)
    const [x1, y1] = toPoint(R * 0.66, a)
    const [x2, y2] = toPoint(R * 0.93, a * 1.05)
    blobs.push({ cx: x1, cy: y1, r: R * 0.36 }, { cx: x2, cy: y2, r: R * 0.24 })
  }
  return blobs
}
