import { hierarchy, tree } from 'd3-hierarchy'
import type { HierarchyNode, HierarchyPointNode } from 'd3-hierarchy'
import type { Gender, NodeType, TreeNode } from '../model'
import { branchBark, taperedPolylinePath } from './geometry'
import type { Point } from './geometry'
import type { TreeIndex } from './tree'

export const MEMBER_W = 150
export const MEMBER_H = 52
export const WIFE_W = 132
export const WIFE_H = 44
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
 * The founder sits on the trunk top and generations fan out above him, up to 70° either side of
 * straight up. Rings are bent into a dome (full radius straight up, pulled in towards the flanks), so
 * the crown is round like an oak instead of a flat fan.
 */
const MAX_THETA = 70 * DEG
/**
 * Inner generations fan out less: near the trunk a ring is small, so a card far round it would sit
 * level with (or below) its parent and its limb would run sideways or down. The fan opens up with each
 * generation, the way a real tree's first limbs climb before they spread.
 */
const INNER_FAN = 0.5
const FAN_GROWTH = 0.25
/** Narrowest a ring's fan gets while it is narrowed so flank cards climb. */
const MIN_FAN = 25 * DEG
const fanOf = (generation: number) => MAX_THETA * Math.min(1, INNER_FAN + FAN_GROWTH * Math.max(0, generation - 1))
/** Room between a generation label and the card it names. */
const LABEL_GAP = 16
/** How strongly a full ring spreads its cards evenly over the fan (0 = tidy tree only). */
const SPREAD = 0.5
/** How far the fan's centre moves from the middle of the family towards its weight (0 = middle, 1 = weight). */
const BALANCE = 1
/** 1 = plain circles around the founder, 0 = circles through the founder. */
const DOME = 0.7
const dome = (theta: number) => DOME + (1 - DOME) * Math.cos(theta)
/** Screen point at ring radius r and angle θ (0 = straight up, positive = to the right). */
const toPoint = (r: number, theta: number): Point => [r * dome(theta) * Math.sin(theta), -r * dome(theta) * Math.cos(theta)]
const unit = (x: number, y: number): Point => {
  const len = Math.hypot(x, y) || 1
  return [x / len, y / len]
}
/**
 * Unit direction a limb grows in at a card: away from a point below the founder (`focus` units down).
 * Limbs near the trunk then head upward whatever their angle, and only the outer crown fans out
 * sideways, the way a real tree grows.
 */
const outward = ({ x, y }: { x: number; y: number }, focus: number): Point => unit(x, y - focus)
/** How far below the founder limbs seem to grow from, as a fraction of the crown radius. */
const FOCUS_DEPTH = 0.5
/** A narrow tree is stretched to fill the fan, but never more than this (small families stay upright). */
const MAX_STRETCH = 2
/** A ring is only allowed to be this full before it is pushed outward (room for the tidy tree's slack). */
const RING_FILL = 0.6
/** Radial room added between two rings whose cards touch. */
const RING_BUMP = 16
/**
 * Radial distance between the two staggered rows of a crowded generation, near the top of the crown.
 * (More rows gain nothing: a branch to an outer row must still pass between the inner-row cards.)
 */
const LANE_STEP = MEMBER_H + PAD_Y + 10
/** A ring needs at least this many cards before it is split into two rows. */
const MIN_LANE_CARDS = 4
const MAX_ATTEMPTS = 120

/** Branch width: the trunk top for the founder, then 25% thinner every generation. */
const TRUNK_TOP = 48
const TAPER = 0.75
const MIN_LIMB = 3
/**
 * A branch is never thicker than the family it carries needs: width grows with the square root of the
 * people on it (the pipe model of real trees), so a childless daughter of the founder gets a twig, not
 * a limb as thick as her brothers' that carry hundreds.
 */
const FAMILY_WIDTH = 12
/** A limb flares at most this much wider than the branch it becomes, where it leaves its parent. */
const FLARE = 1.3
/** A card sits at least this many of its parent's branch widths away from it. */
const KNOT_CLEAR = 1.2
/** Widest a branch may end under a card that nothing grows from. */
const LEAF_TIP = MEMBER_H * 0.5
/** A generation's ring sits at least this many of its limb widths beyond the one before. */
const LIMB_LENGTH = 2.5
/** Husband → wife is a fork rather than a limb: shorter, but still longer than it is thick. */
const WIFE_LIMB_LENGTH = 1.3
/**
 * Radial room a limb gets per unit of sideways travel, so a limb that must reach far to the side climbs
 * at a slant like a real branch instead of running flat along the ring.
 */
const TURN_SLOPE = 0.35
/** …but never more than this per ring, or rings whose limbs all turn far would push the crown out without end. */
const MAX_TURN_ROOM = 3000
/** A card sits at least this much higher than its parent per unit it sits to the side (no flat or falling limbs). */
const CLIMB = 0.35

/** Most a ring is pushed out so its limbs climb (more would stretch the whole crown for one card). */
const MAX_CLIMB_ROOM = 600
/** Most a whole ring is pushed out, all attempts together, so its limbs climb (one far card must not stretch every limb). */
const MAX_RING_CLIMB = 1000
/** Cards on show for each step up in trunk scale (the trunk scales with the square root of the count). */
const TRUNK_CARDS = 40

/**
 * How much further out (radially) card b must sit for its limb from a to climb at CLIMB (0 if it already
 * does). Far round the flank moving out mostly moves sideways and cannot help, so a flat limb there gets
 * Infinity: only moving the card round, not out, lifts it.
 */
function climbRoom(a: { x: number; y: number }, b: { x: number; y: number; theta: number }): number {
  const slack = climbSlack(a, b)
  // Far round the flank no radial room helps: a flat limb there needs infinite room.
  if (slack === -Infinity) return a.y - b.y >= CLIMB * Math.abs(b.x - a.x) ? 0 : Infinity
  return Math.max(0, slack)
}

/**
 * Like `climbRoom`, but negative when b climbs with room to spare: how far it could come in and still
 * climb. −Infinity far round the flank, where moving in or out makes no difference to the climb.
 */
function climbSlack(a: { x: number; y: number }, b: { x: number; y: number; theta: number }): number {
  const rise = a.y - b.y
  const side = b.x - a.x
  // Moving b out by Δ along its angle raises it by Δ·c and shifts it sideways by Δ·s.
  const c = dome(b.theta) * Math.cos(b.theta)
  const s = dome(b.theta) * Math.sin(b.theta)
  const away = Math.sign(side) === Math.sign(s) ? Math.abs(s) : -Math.abs(s)
  const gain = c - CLIMB * away
  if (gain < 0.12) return -Infinity
  return Math.min(MAX_CLIMB_ROOM, (CLIMB * Math.abs(side) - rise) / gain + 1)
}

/** How far along the limb its ends keep their heading (fraction of the limb's length). */
const LIMB_BEND = 0.4
/** A limb leaves its parent between "straight at the child" (0) and "straight outward" (large). */
const LEAVE_UP = 0.6
/** …and arrives heading outward, leaning this much towards where it came from. */
const ARRIVE_LEAN = 0.35

/** Times `pullIn` sweeps the crown (it stops early once nothing moves). */
const PULL_PASSES = 2

/** Points sampled along each branch's centre-line. */
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
  /** The card this branch grows from (an unknown mother's children grow from her husband). */
  from: string
  d: string
  /** Round knot [x, y, radius] where the branch leaves its parent, so forks join without seams. */
  knot: [number, number, number]
  /** Bark drawn over the wood: shaded underside, lit ridge and veins along the grain. */
  bark: { shade: string; light: string; veins: string }
  /** Centre-line of the branch, parent → child. */
  spine: Point[]
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
  /** Anchor (right edge, vertical middle) of each generation's label, beside its leftmost card. */
  rings: Array<{ generation: number; x: number; y: number }>
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
function relaxAngles(thetas: number[], gaps: number[], limit: number): number[] {
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
  const hi = limit - offset[offset.length - 1]
  const out: number[] = []
  for (const { mean, count } of pools) {
    const u = Math.min(hi, Math.max(-limit, mean))
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
  /**
   * Radial room a ring needs so its limbs can turn and climb, worked out afresh from every attempt's
   * positions (never added up: an early attempt, before the angles settle, would otherwise leave every
   * ring pushed out for good).
   */
  const bend = levels.map(() => 0)
  const radius: number[] = []
  /** Rows per ring: 2 for crowded generations. */
  const lanes = levels.map(() => 1)
  /** How far each ring's outermost row sits beyond the ring (grows where rows touch). */
  const laneSpread = levels.map(() => 0)
  /** Extra factor on the gap after a card (d3 order), grown where two cards of one ring still touch. */
  const boost = new Map<string, number>()
  /** Half-angle of each ring's fan (see `fanOf`). */
  const fan = levels.map((ring) => fanOf(ring.find((n) => !n.data.unknown)?.data.generation ?? 1))
  const ringOrder = levels.map((ring) => ring.filter((n) => !n.data.unknown).map((n) => n.data.id))
  /** People on a branch: the card and everyone above it, folded away or not. */
  const weight = (n: HierarchyNode<TreeNode>) => 1 + (index.get(n.data.id)?.descendants ?? 0)
  /** Width of the branch where it reaches a card (the founder's is the trunk top). */
  const branchWidth = (n: HierarchyNode<TreeNode>) => {
    const generation = limbWidth(n.data.generation, trunkScale)
    return n.parent ? Math.max(MIN_LIMB, Math.min(generation, FAMILY_WIDTH * Math.sqrt(weight(n)))) : generation
  }
  /** Limb parent of a card: an unknown mother's children grow from her husband. */
  const limbFrom = (n: HierarchyNode<TreeNode>) => (n.parent?.data.unknown ? n.parent.parent! : n.parent!)
  /** Width of the limb to a card where it leaves its parent. */
  const baseWidth = (n: HierarchyNode<TreeNode>) => Math.min(branchWidth(limbFrom(n)), FLARE * branchWidth(n))
  /**
   * Thick limbs need length to read as limbs rather than knots: a card sits at least a few of its limb's
   * widths out, and clear of the wood it grows from (a twig off the trunk must not sit inside the trunk).
   */
  const limbNeed = (n: HierarchyNode<TreeNode>) => {
    if (!n.parent || n.data.unknown) return 0
    const own = (step[n.depth] === CHILD_STEP ? LIMB_LENGTH : WIFE_LIMB_LENGTH) * baseWidth(n)
    return Math.max(step[n.depth], own, KNOT_CLEAR * branchWidth(limbFrom(n)) + cardH(n.data) / 2)
  }
  const limbStep = (d: number) => levels[d].reduce((most, n) => Math.max(most, limbNeed(n)), d ? step[d] : 0)
  /**
   * A tidy tree too wide for the fan is never squeezed (the rings would then shove cards away from
   * their parents and limbs would snake after them): the rings move out instead, which narrows it.
   */
  let grow = 1
  const placeRings = () =>
    levels.forEach((_, d) => (radius[d] = d ? radius[d - 1] + laneSpread[d - 1] + Math.max(grow * (limbStep(d) + extra[d]), bend[d]) : 0))
  /** Radial distance between two rows at angle θ: stacked vertically near the top, side by side on the steep flanks. */
  const laneStep = (theta: number) =>
    Math.min(LANE_STEP / Math.max(Math.abs(Math.cos(theta)), 1e-3), (MEMBER_W + PAD_X) / Math.max(Math.abs(Math.sin(theta)), 1e-3))

  /**
   * Trunk (and so every limb) grows with the number of cards on show. Fixed before the rings are laid
   * out: scaling it with the crown's size fed back on itself (a bigger crown made thicker limbs, which
   * need longer limbs, which made a bigger crown).
   */
  const shown = all.filter((n) => !n.data.unknown).length
  const trunkScale = Math.min(9, Math.max(1, Math.sqrt(shown / TRUNK_CARDS)))
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
    const limbs = a.parent === b.parent ? 0 : (baseWidth(a) + baseWidth(b)) / 2 + PAD_X
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
      const ratio = need / (2 * fan[d] * RING_FILL)
      // Two rows only pay off in a crowd: with a few cards the outer one would sit right behind the inner.
      if (ratio > 1 && lanes[d] === 1 && cards.length >= MIN_LANE_CARDS) {
        lanes[d] = 2
        laneSpread[d] = Math.max(laneSpread[d], LANE_STEP)
        placeRings()
      }
      if (ratio > lanes[d]) {
        extra[d] += (radius[d] * (ratio / lanes[d] - 1)) / grow
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
    // The fan centres between the span's middle and where most people are, so a crown with one big
    // family does not lean; the side that sticks out further sets how much the fan must hold.
    let mass = 0
    for (const n of all) mass += n.x!
    mass /= all.length
    const mid = (1 - BALANCE) * ((minX + maxX) / 2) + BALANCE * Math.min(maxX, Math.max(minX, mass))
    const span = 2 * Math.max(mid - minX, maxX - mid)
    // Stretch a narrow tree to fill the fan; a wide one grows the rings for the next attempt.
    const fit = span > 0 ? Math.min(MAX_STRETCH, (2 * MAX_THETA) / span) : 1
    const tooWide = span > 2 * MAX_THETA * 1.02
    if (tooWide) grow *= span / (2 * MAX_THETA)
    // Mirrored: the first-born (smallest d3 x) sits on the right, matching Arabic reading order.
    const toTheta = (x: number) => -(x - mid) * fit

    const thetas = new Map<string, number>()
    const crowded: number[] = []
    levels.forEach((level, depth) => {
      // Ascending angle = reverse d3 order.
      const cards = level.filter((n) => !n.data.unknown && n.parent).reverse()
      if (!cards.length) return
      const gaps = cards.slice(1).map((n, k) => laneGap(cards[k], n) * (boost.get(n.data.id) ?? 1))
      const limit = fan[depth]
      if (gaps.reduce((s, g) => s + g, 0) > 2 * limit) crowded.push(depth)
      // Fill the holes shallow families leave: a crowded ring leans towards spreading its cards evenly
      // over the fan (keeping their order, so limbs still cannot cross); a sparse ring keeps the tidy angles.
      const total = gaps.reduce((s, g) => s + g, 0)
      const lean = total > 0 ? SPREAD * Math.min(1, total / (2 * limit)) : 0
      let before = 0
      const relaxed = relaxAngles(
        cards.map((n, k) => {
          const even = -limit + (2 * limit * before) / (total || 1)
          before += gaps[k] ?? 0
          return (1 - lean) * toTheta(n.x!) * (limit / MAX_THETA) + lean * even
        }),
        gaps,
        limit,
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
    let moved = tooWide
    for (const [id, t] of thetas) {
      if (Math.abs((lastTheta.get(id) ?? 99) - t) > 2 * DEG) moved = true
      lastTheta.set(id, t)
    }

    for (const d of crowded) extra[d] += RING_BUMP / grow
    // A limb that must turn far needs radial room to do it, or it wraps along the ring like an arch.
    const turnRoom = levels.map(() => 0)
    /** …and a card off to the side of its parent must still sit above it. */
    const climbNeed = levels.map(() => -Infinity)
    const flat = new Set<number>()
    for (const n of all) {
      const from = n.parent?.data.unknown ? n.parent.parent : n.parent
      if (!from?.parent || n.data.unknown) continue
      const a = polar.get(from.data.id)!
      const b = polar.get(n.data.id)!
      // How far the child sits to the side of the parent's outward heading.
      const [ux, uy] = outward(a, outerRadius * FOCUS_DEPTH)
      const sideways = Math.abs(ux * (b.y - a.y) - uy * (b.x - a.x))
      turnRoom[n.depth] = Math.max(turnRoom[n.depth], Math.min(MAX_TURN_ROOM, sideways * TURN_SLOPE))
      const slack = climbSlack(a, b)
      climbNeed[n.depth] = Math.max(climbNeed[n.depth], slack)
      // Far round the flank only a narrower fan lifts a card that sits level with its parent.
      if (slack === -Infinity && a.y - b.y < CLIMB * Math.abs(b.x - a.x)) flat.add(n.depth)
    }
    turnRoom.forEach((need, d) => {
      if (!d) return
      const base = grow * (limbStep(d) + extra[d])
      const room = Math.max(base, bend[d])
      // Where the ring could sit for every limb to climb: further out, or further in if all climb with room to spare.
      const climb = climbNeed[d] === -Infinity ? 0 : Math.min(base + MAX_RING_CLIMB, room + climbNeed[d])
      const want = Math.max(need, climb)
      // Half way there each attempt (in or out), so the rings settle instead of see-sawing.
      const next = Math.abs(want - room) < 2 ? want : room + (want - room) / 2
      if (Math.abs(Math.max(base, next) - room) > 2) moved = true
      bend[d] = next > base ? next : 0
    })
    for (const d of flat) {
      if (fan[d] <= MIN_FAN) continue
      fan[d] = Math.max(MIN_FAN, fan[d] * 0.92)
      moved = true
    }
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
    for (const [d, need] of clash) extra[d] += need / grow
    if (!crowded.length && !clash.size && !sameRing.length && !moved) break
  }

  // Limbs keep bending around the focus the rings were built with, even once the crown has shrunk.
  const focus = outerRadius * FOCUS_DEPTH
  outerRadius = pullIn(all, polar, limbNeed, focus)

  const nodes: LayoutNode[] = []
  const links: LayoutLink[] = []
  /** Heading of the limb where it reaches each card (parents come before their children in `all`). */
  const arrival = new Map<string, Point>()
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
     * One smooth limb: it leaves the parent heading outward (the way the parent's own limb grew) and
     * reaches the child from below, so it never wraps along a ring. The layout gives far-reaching limbs
     * extra height (TURN_SLOPE), so they climb at a slant instead of running flat.
     */
    const len = Math.hypot(p.x - pp.x, p.y - pp.y) || 1
    const [dx, dy] = [(p.x - pp.x) / len, (p.y - pp.y) / len]
    // It leaves carrying on the way its parent's own limb arrived (so the wood flows through the fork),
    // leaning towards the child, and bends upward once near the end: a single bow, not an S.
    const [ox, oy] = arrival.get(from.data.id) ?? outward(pp, focus)
    const [ex, ey] = outward(p, focus)
    const [ax, ay] = unit(dx + ox * LEAVE_UP, dy + oy * LEAVE_UP)
    const [bx, by] = unit(ex + dx * ARRIVE_LEAN, ey + dy * ARRIVE_LEAN)
    arrival.set(d.id, [bx, by])
    const c1: Point = [pp.x + ax * len * LIMB_BEND, pp.y + ay * len * LIMB_BEND]
    const c2: Point = [p.x - bx * len * LIMB_BEND, p.y - by * len * LIMB_BEND]
    const centre: Point[] = []
    for (let i = 0; i <= BRANCH_SAMPLES; i++) {
      const t = i / BRANCH_SAMPLES
      const mt = 1 - t
      const [a, b, c, e] = [mt * mt * mt, 3 * mt * mt * t, 3 * mt * t * t, t * t * t]
      centre.push([a * pp.x + b * c1[0] + c * c2[0] + e * p.x, a * pp.y + b * c1[1] + c * c2[1] + e * p.y])
    }

    // A branch starts a little wider than the family it carries (never wider than its parent) and ends at that width.
    const w0 = baseWidth(n)
    // A branch nobody grows from (no children, or folded away) runs out to a twig under its card
    // instead of ending in a sawn-off stump wider than the card.
    const tip = d.children.length === 0 || collapsed
    const w1 = tip ? Math.min(branchWidth(n), LEAF_TIP) : branchWidth(n)
    const pad = w0 / 2
    const xs = centre.map((q) => q[0])
    const ys = centre.map((q) => q[1])
    links.push({
      id: d.id,
      from: from.data.id,
      d: taperedPolylinePath(centre, w0, w1),
      knot: [pp.x, pp.y, w0 / 2],
      bark: branchBark(centre, w0, w1, d.id),
      spine: centre,
      box: {
        minX: Math.min(...xs) - pad,
        minY: Math.min(...ys) - pad,
        maxX: Math.max(...xs) + pad,
        maxY: Math.max(...ys) + pad,
      },
    })
  }

  // One label per generation of blood members, just left of that generation's leftmost card.
  const rings: TreeLayout['rings'] = []
  for (const level of levels) {
    let left: LayoutNode | undefined
    for (const n of level) {
      const node = byId.get(n.data.id)
      if (node && node.type === 'member' && !node.isRoot && (!left || node.x < left.x)) left = node
    }
    if (left) rings.push({ generation: left.generation, x: left.x - cardHalf(left.type, !!left.husband).hw - LABEL_GAP, y: left.y })
  }

  return { nodes, links, byId, bounds, crown: crownBlobs(nodes, outerRadius), rings, trunkScale }
}

/**
 * Rings are pushed out as a whole, so one limb that must reach far sideways (or one crowded corner)
 * lengthens every limb of that generation. This pass walks the tree from the trunk out and slides each
 * family (a card with everything above it) back in along its angle, as far as its own limb's length and
 * turn allow without touching another card or crossing another limb. Returns the new outer radius.
 */
function pullIn(all: HierarchyNode<TreeNode>[], polar: Map<string, Polar>, minLength: (n: HierarchyNode<TreeNode>) => number, focus: number): number {
  const CELL = 250
  const cellOf = (x: number, y: number) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`

  const cards = new Map<string, Set<string>>()
  const addCard = (id: string, p: Polar) => {
    const key = cellOf(p.x, p.y)
    const cell = cards.get(key)
    if (cell) cell.add(id)
    else cards.set(key, new Set([id]))
  }
  for (const [id, p] of polar) if (p.w) addCard(id, p)

  /** Limb parent of every visible card (an unknown mother's children grow from her husband). */
  const parentOf = new Map<string, string>()
  for (const n of all) {
    const from = n.parent?.data.unknown ? n.parent.parent : n.parent
    if (from && !n.data.unknown) parentOf.set(n.data.id, from.data.id)
  }
  /** Centre-line of the limb to `child`, built the same way as the drawn one (see computeLayout). */
  const curve = (child: string, pos: (id: string) => Polar): Point[] => {
    const parent = parentOf.get(child)!
    const [pp, p] = [pos(parent), pos(child)]
    const len = Math.hypot(p.x - pp.x, p.y - pp.y) || 1
    const [dx, dy] = [(p.x - pp.x) / len, (p.y - pp.y) / len]
    // It leaves the way the parent's own limb arrived.
    const grand = parentOf.get(parent)
    let [ox, oy] = outward(pp, focus)
    if (grand) {
      const g = pos(grand)
      const [gx, gy] = unit(pp.x - g.x, pp.y - g.y)
      ;[ox, oy] = unit(ox + gx * ARRIVE_LEAN, oy + gy * ARRIVE_LEAN)
    }
    const [ex, ey] = outward(p, focus)
    const [ax, ay] = unit(dx + ox * LEAVE_UP, dy + oy * LEAVE_UP)
    const [bx, by] = unit(ex + dx * ARRIVE_LEAN, ey + dy * ARRIVE_LEAN)
    const c1: Point = [pp.x + ax * len * LIMB_BEND, pp.y + ay * len * LIMB_BEND]
    const c2: Point = [p.x - bx * len * LIMB_BEND, p.y - by * len * LIMB_BEND]
    const out: Point[] = []
    for (let i = 0; i <= BRANCH_SAMPLES; i++) {
      const t = i / BRANCH_SAMPLES
      const mt = 1 - t
      const [a, b, c, e] = [mt * mt * mt, 3 * mt * mt * t, 3 * mt * t * t, t * t * t]
      out.push([a * pp.x + b * c1[0] + c * c2[0] + e * p.x, a * pp.y + b * c1[1] + c * c2[1] + e * p.y])
    }
    return out
  }
  /** Cells each limb's curve passes through, so a crossing test only looks at limbs nearby. */
  const shapes = new Map<string, Point[]>()
  const limbCells = new Map<string, Set<string>>()
  const cellsOfCurve = (pts: Point[]) => {
    const keys = new Set<string>()
    for (let i = 1; i < pts.length; i++) {
      const [x0, x1] = [Math.min(pts[i - 1][0], pts[i][0]), Math.max(pts[i - 1][0], pts[i][0])]
      const [y0, y1] = [Math.min(pts[i - 1][1], pts[i][1]), Math.max(pts[i - 1][1], pts[i][1])]
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
        for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) keys.add(`${cx},${cy}`)
    }
    return keys
  }
  const placeLimb = (child: string, pts: Point[]) => {
    for (const key of cellsOfCurve(shapes.get(child) ?? [])) limbCells.get(key)?.delete(child)
    shapes.set(child, pts)
    for (const key of cellsOfCurve(pts)) {
      const cell = limbCells.get(key)
      if (cell) cell.add(child)
      else limbCells.set(key, new Set([child]))
    }
  }
  for (const child of parentOf.keys()) placeLimb(child, curve(child, (id) => polar.get(id)!))

  const side = (p: Point, q: Point, r: Point) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const cross = (p: Point, q: Point, r: Point, t: Point) => side(p, q, r) * side(p, q, t) < 0 && side(r, t, p) * side(r, t, q) < 0
  /** Interiors only: limbs meeting at a fork or a card touch there by design. */
  const boxes = new WeakMap<Point[], Box>()
  const boxOf = (pts: Point[]) => {
    let box = boxes.get(pts)
    if (!box) {
      box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
      for (let i = 1; i < pts.length - 1; i++) {
        box.minX = Math.min(box.minX, pts[i][0])
        box.maxX = Math.max(box.maxX, pts[i][0])
        box.minY = Math.min(box.minY, pts[i][1])
        box.maxY = Math.max(box.maxY, pts[i][1])
      }
      boxes.set(pts, box)
    }
    return box
  }
  const tangled = (a: Point[], b: Point[]) => {
    const [p, q] = [boxOf(a), boxOf(b)]
    if (p.maxX < q.minX || q.maxX < p.minX || p.maxY < q.minY || q.maxY < p.minY) return false
    for (let u = 1; u < a.length - 2; u++) for (let v = 1; v < b.length - 2; v++) if (cross(a[u], a[u + 1], b[v], b[v + 1])) return true
    return false
  }

  // Each pass frees room for families that were blocked by a neighbour that had not moved in yet.
  for (let pass = 0; pass < PULL_PASSES; pass++) {
    let movedAny = false
    for (const n of all) {
      // Breadth-first: a card's parent has already settled.
      const parent = parentOf.get(n.data.id)
      if (!parent) continue
      const a = polar.get(parent)!
      const b = polar.get(n.data.id)!
      const slack = b.r - a.r - minLength(n)
      if (slack < 2) continue
      const family = n.descendants()
      const ids = new Set(family.map((m) => m.data.id))
      const [ux, uy] = outward(a, focus)
      for (const f of [1, 0.8, 0.6, 0.4, 0.2]) {
        const shift = slack * f
        const at = new Map<string, Polar>()
        const moved = (id: string, by: number) => {
          const p = polar.get(id)!
          const [x, y] = toPoint(p.r - by, p.theta)
          return { ...p, r: p.r - by, x, y }
        }
        const nb = moved(n.data.id, shift)
        // The limb still needs room to turn towards a card off to its side.
        const sideways = Math.abs(ux * (nb.y - a.y) - uy * (nb.x - a.x))
        if (nb.r - a.r < Math.min(MAX_TURN_ROOM, sideways * TURN_SLOPE) || climbRoom(a, nb) > 1) continue
        // Cards already settled this round, so the family's own cards never land on each other either.
        const ownCards = new Map<string, Polar[]>()
        const free = (p: Polar) => {
          const cx = Math.floor(p.x / CELL)
          const cy = Math.floor(p.y / CELL)
          for (let i = cx - 1; i <= cx + 1; i++)
            for (let j = cy - 1; j <= cy + 1; j++) {
              for (const other of cards.get(`${i},${j}`) ?? []) if (!ids.has(other) && collides(p, polar.get(other)!)) return false
              for (const q of ownCards.get(`${i},${j}`) ?? []) if (collides(p, q)) return false
            }
          return true
        }
        const settle = (p: Polar) => {
          const key = `${Math.floor(p.x / CELL)},${Math.floor(p.y / CELL)}`
          const own = ownCards.get(key)
          if (own) own.push(p)
          else ownCards.set(key, [p])
        }
        /*
         * Breadth-first, each card comes in as far as its parent did if it can, else half that, else stays:
         * a stuck grandchild then only lengthens its own limb instead of holding the whole family out.
         */
        const shiftOf = new Map<string, number>()
        let hits = false
        for (const m of family) {
          const id = m.data.id
          const most = m === n ? shift : shiftOf.get(m.parent!.data.id)!
          // An unknown mother sits exactly on her husband.
          const tries = m === n ? [shift] : m.data.unknown || !most ? [most] : [most, most / 2, 0]
          const by = tries.find((t) => !polar.get(id)!.w || free(moved(id, t)))
          if (by === undefined) {
            hits = true
            break
          }
          shiftOf.set(id, by)
          const p = by ? moved(id, by) : polar.get(id)!
          if (by) at.set(id, p)
          if (p.w) settle(p)
        }
        if (hits) continue
        const pos = (id: string) => at.get(id) ?? polar.get(id)!
        // Moving a parent in can leave a child that stayed put level with it: every limb must still climb.
        const falls = family.some((m) => {
          const parent = parentOf.get(m.data.id)
          if (m === n || !parent || !(at.has(parent) || at.has(m.data.id))) return false
          return climbRoom(pos(parent), pos(m.data.id)) > 1 && climbRoom(polar.get(parent)!, polar.get(m.data.id)!) <= 1
        })
        if (falls) continue
        // A limb's shape depends on its child, its parent and the grandparent (the way it leaves): only
        // limbs where one of those moved are redrawn and checked.
        const changed = new Set<string>()
        for (const m of family) {
          const c = m.data.id
          const parent = parentOf.get(c)
          if (parent && (at.has(c) || at.has(parent) || at.has(parentOf.get(parent) ?? ''))) changed.add(c)
        }
        // Cheapest first: a card that moved must not land on a limb that stays put.
        const landsOnLimb = [...at].some(([id, p]) => {
          if (!p.w) return false
          const near = new Set<string>()
          for (let gx = Math.floor((p.x - p.w / 2) / CELL); gx <= Math.floor((p.x + p.w / 2) / CELL); gx++)
            for (let gy = Math.floor((p.y - p.h / 2) / CELL); gy <= Math.floor((p.y + p.h / 2) / CELL); gy++)
              for (const other of limbCells.get(`${gx},${gy}`) ?? []) if (!changed.has(other) && other !== id && parentOf.get(other) !== id) near.add(other)
          for (const other of near) {
            const pts = shapes.get(other)!
            for (let i = 1; i < pts.length - 1; i++) if (Math.abs(pts[i][0] - p.x) < p.w / 2 && Math.abs(pts[i][1] - p.y) < p.h / 2) return true
          }
          return false
        })
        if (landsOnLimb) continue
        const curves = new Map<string, Point[]>()
        // Moving along the dome is not rigid, so the redrawn limbs are checked against each other too.
        const ownCells = new Map<string, string[]>()
        const crossing = [...changed].some((c) => {
          const pts = curve(c, pos)
          curves.set(c, pts)
          const near = new Set<string>()
          for (const key of cellsOfCurve(pts)) {
            for (const other of limbCells.get(key) ?? []) if (!changed.has(other)) near.add(other)
            for (const other of ownCells.get(key) ?? []) near.add(other)
            const own = ownCells.get(key)
            if (own) own.push(c)
            else ownCells.set(key, [c])
          }
          for (const other of near) if (tangled(pts, curves.get(other) ?? shapes.get(other)!)) return true
          return false
        })
        if (crossing) continue
        // No limb may run under a card it does not belong to (cards hide it, and it reads as growing from there).
        const movedCards = new Map<string, string[]>()
        for (const [id, p] of at) {
          if (!p.w) continue
          const key = cellOf(p.x, p.y)
          const cell = movedCards.get(key)
          if (cell) cell.push(id)
          else movedCards.set(key, [id])
        }
        const covered = (pts: Point[], child: string) => {
          const parent = parentOf.get(child)
          for (let i = 1; i < pts.length - 1; i++) {
            const [x, y] = pts[i]
            // Only cells a card centred there could reach (cards are at most COUPLE_W wide, MEMBER_H tall).
            for (let gx = Math.floor((x - COUPLE_W / 2) / CELL); gx <= Math.floor((x + COUPLE_W / 2) / CELL); gx++)
              for (let gy = Math.floor((y - MEMBER_H / 2) / CELL); gy <= Math.floor((y + MEMBER_H / 2) / CELL); gy++) {
                const key = `${gx},${gy}`
                // Moving cards are looked up where they are going, everyone else where they are.
                for (const other of cards.get(key) ?? []) {
                  if (other === child || other === parent || at.has(other)) continue
                  const q = polar.get(other)!
                  if (Math.abs(x - q.x) < q.w / 2 && Math.abs(y - q.y) < q.h / 2) return true
                }
                for (const other of movedCards.get(key) ?? []) {
                  if (other === child || other === parent) continue
                  const q = at.get(other)!
                  if (Math.abs(x - q.x) < q.w / 2 && Math.abs(y - q.y) < q.h / 2) return true
                }
              }
          }
          return false
        }
        if ([...curves].some(([child, pts]) => covered(pts, child))) continue
        for (const [id, p] of at) {
          const old = polar.get(id)!
          if (old.w) cards.get(cellOf(old.x, old.y))!.delete(id)
          polar.set(id, p)
          if (p.w) addCard(id, p)
        }
        for (const [id, pts] of curves) placeLimb(id, pts)
        movedAny = true
        break
      }
    }
    if (!movedAny) break
  }
  let r = 0
  for (const p of polar.values()) r = Math.max(r, p.r)
  return r
}

/**
 * Leafy crown that follows the real branches: cards are binned on a coarse grid and every occupied
 * cell gets one big soft blob, so the canopy leans and gaps where the tree does.
 */
function crownBlobs(nodes: LayoutNode[], outer: number): CrownBlob[] {
  const cell = Math.max(320, outer / 7)
  const bins = new Map<string, { x: number; y: number; n: number }>()
  for (const { x, y, isRoot } of nodes) {
    if (isRoot) continue
    const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`
    const bin = bins.get(key) ?? { x: 0, y: 0, n: 0 }
    bin.x += x
    bin.y += y
    bin.n++
    bins.set(key, bin)
  }
  return [...bins.values()].map(({ x, y, n }) => ({ cx: x / n, cy: y / n, r: cell * (0.75 + 0.1 * Math.min(3, n - 1)) }))
}
