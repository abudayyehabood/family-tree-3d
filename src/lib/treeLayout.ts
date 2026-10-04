import { hierarchy, tree } from 'd3-hierarchy'
import type { HierarchyNode } from 'd3-hierarchy'
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

/** Room between neighbouring cards in a row. */
const PAD_X = 8
/** Neighbours with different parents keep this much more room than siblings. */
const COUSIN_PAD = 24
/** Room between a generation label and the card it names. */
const LABEL_GAP = 16

/**
 * Every generation of the tree is one row, and every row is as wide as its people need. (The crown used
 * to be rings round the founder, but a ring near the trunk is short: a family that did not fit side by
 * side on it pushed the whole ring, and every limb of that generation, up and out.) A row is only as far
 * above the one before as its limbs need: a step, a few limb widths for thick ones, and enough rise that
 * a limb reaching far sideways still climbs.
 */
const CLIMB = 0.25
/** …but a row never climbs more than this many steps for one far-reaching limb. */
const MAX_CLIMB_STEPS = 3
/**
 * A row of children with this many cards packs them in two staggered tiers, every other card a little higher, so
 * neighbours may overlap sideways. A row of many small families is then about half as wide, and the
 * limbs that reach across to it about half as long. (One flat row of 17 cards made a 39-card view three
 * times wider than tall, with limbs sweeping across the whole crown.)
 */
const TIER_CARDS = 6
/** The upper tier sits this far above the lower one. */
const TIER_RISE = MEMBER_H + 14
/** How far the crown moves sideways so it sits balanced over the trunk (0 = founder over his wives, 1 = over everyone). */
const BALANCE = 0.6

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
/** A row sits at least this many of its limb widths above the one before. */
const LIMB_LENGTH = 2.5
/** Husband → wife is a fork rather than a limb: shorter, but still longer than it is thick. */
const WIFE_LIMB_LENGTH = 1.3
/** Cards on show for each step up in trunk scale (the trunk scales with the square root of the count). */
const TRUNK_CARDS = 40

/** How far along the limb its ends keep their heading (fraction of the limb's length). */
const LIMB_BEND = 0.4
/** …but never further than this many times its rise. */
const RISE_BEND = 1
/** A limb leaves its parent between "straight at the child" (0) and "straight up" (large). */
const LEAVE_UP = 0.6
/** …and arrives heading up, leaning this much towards where it came from. */
const ARRIVE_LEAN = 0.35

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
  /** Trunk scale (1 for normal families, grows for big crowns so the trunk stays proportional). */
  trunkScale: number
}

const cardW = (n: TreeNode) => (n.unknown ? 0 : 2 * cardHalf(n.type, !!n.husband).hw)
const cardH = (n: TreeNode) => (n.unknown ? 0 : 2 * cardHalf(n.type, !!n.husband).hh)

const unit = (x: number, y: number): Point => {
  const len = Math.hypot(x, y) || 1
  return [x / len, y / len]
}

/** Width of every branch of one generation (the founder's equals the trunk top). */
const limbWidth = (generation: number, trunkScale: number) => Math.max(MIN_LIMB, TRUNK_TOP * trunkScale * TAPER ** (generation - 1))

export function computeLayout(data: TreeNode, index: TreeIndex): TreeLayout {
  const root = hierarchy(data, (d) => (d.collapsed ? null : d.children))
  const all = root.descendants()

  const levels: Array<Array<HierarchyNode<TreeNode>>> = []
  for (const n of all) (levels[n.depth] ??= []).push(n)
  const step = levels.map((ring, depth) => {
    const cards = ring.filter((n) => !n.data.unknown)
    if (!depth || !cards.length) return 0
    return cards[0].data.type === 'wife' ? WIFE_STEP : CHILD_STEP
  })

  /** The trunk (and so every limb) grows with the number of cards on show. */
  const shown = all.filter((n) => !n.data.unknown).length
  const trunkScale = Math.min(9, Math.max(1, Math.sqrt(shown / TRUNK_CARDS)))
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

  // Across: a tidy tree in world units, so neighbours are exactly as far apart as their cards (and the
  // limbs of two families between them) need.
  // Wife rows stay flat: their step is short, so a limb reaching far sideways has no room to swing
  // under the lower tier, and a wife's children spread her row out anyway.
  const tiered = levels.map((level, d) => step[d] === CHILD_STEP && level.filter((n) => !n.data.unknown).length >= TIER_CARDS)
  tree<TreeNode>()
    .nodeSize([1, 1])
    .separation((a, b) => {
      // Staggered: a card only has to clear its neighbours on the other tier by a limb's width, so the
      // limb to the card between two others still passes between them.
      if (tiered[a.depth]) return Math.max(cardW(a.data), cardW(b.data)) / 2 + Math.max(baseWidth(a), baseWidth(b)) / 2 + 2 * PAD_X + 2
      const cards = (cardW(a.data) + cardW(b.data)) / 2 + PAD_X + (a.parent === b.parent ? 0 : COUSIN_PAD)
      // Branches of different families must not merge (siblings may: they fork from one limb anyway).
      const limbs = a.parent === b.parent ? 0 : (baseWidth(a) + baseWidth(b)) / 2 + PAD_X
      return Math.max(cards, limbs) + 2
    })(root)
  // Mirrored: the first-born (smallest d3 x) sits on the right, matching Arabic reading order. The crown
  // moves part of the way towards where its people are, so one big family does not hang off to one side.
  let mass = 0
  for (const n of all) mass += n.x!
  mass = all.length > 1 ? (mass - root.x!) / (all.length - 1) - root.x! : 0
  const xOf = (n: HierarchyNode<TreeNode>) => (n.parent ? -(n.x! - root.x! - BALANCE * mass) : 0)
  const x = new Map(all.map((n) => [n.data.id, n.data.unknown ? 0 : xOf(n)]))
  // An unknown mother sits exactly on her husband.
  for (const n of all) if (n.data.unknown) x.set(n.data.id, x.get(n.parent!.data.id)!)

  // Which cards of a staggered row go up a tier: left to right, a card goes up only where it would
  // overlap the last card on the lower tier.
  const lift = new Set<string>()
  levels.forEach((level, d) => {
    if (!tiered[d]) return
    let edge = -Infinity
    for (const n of level.filter((m) => !m.data.unknown).sort((a, b) => x.get(a.data.id)! - x.get(b.data.id)!)) {
      const [cx, half] = [x.get(n.data.id)!, cardW(n.data) / 2]
      if (cx - half < edge + PAD_X) lift.add(n.data.id)
      else edge = cx + half
    }
  })

  // Up: each row as far above the last as its limbs need.
  const rowY: number[] = [0]
  /** Top of each row's cards: its upper tier when it has one. */
  const rowTop: number[] = [0]
  const tierOf = (n: HierarchyNode<TreeNode>) => (lift.has(n.data.id) ? TIER_RISE : 0)
  for (let d = 1; d < levels.length; d++) {
    const cards = levels[d].filter((n) => !n.data.unknown)
    // Never closer to the last row's top tier than a card's height and a little room for limbs.
    let need = cards.length && levels[d - 1].some((n) => !n.data.unknown) ? MEMBER_H + 20 : 0
    for (const n of cards) {
      const from = limbFrom(n)
      // Rows between the parent and this one already lift the limb (an unknown mother's row is empty).
      // A limb from a staggered row only starts to turn once it is past its row's upper tier.
      const below = rowTop[from.depth] - rowTop[d - 1]
      const own = limbNeed(n) - below
      const climb = Math.min(MAX_CLIMB_STEPS * step[d], CLIMB * Math.abs(x.get(n.data.id)! - x.get(from.data.id)!) - below)
      need = Math.max(need, own, climb)
    }
    rowY[d] = rowTop[d - 1] - (cards.length ? need : 0)
    rowTop[d] = rowY[d] - (cards.some((n) => lift.has(n.data.id)) ? TIER_RISE : 0)
  }
  const yOf = (n: HierarchyNode<TreeNode>): number => (n.data.unknown ? yOf(limbFrom(n)) : rowY[n.depth] - tierOf(n))
  const top = -rowTop[rowTop.length - 1]
  /** Limbs head up from a point this far below the founder, so the outer ones lean out like a crown. */
  const focus = Math.max(top, 400) * 0.5
  const outward = (p: { x: number; y: number }): Point => unit(p.x, p.y - focus)

  const nodes: LayoutNode[] = []
  const links: LayoutLink[] = []
  /** Heading of the limb where it reaches each card (parents come before their children in `all`). */
  const arrival = new Map<string, Point>()
  const byId = new Map<string, LayoutNode>()
  const bounds: Box = { minX: -MEMBER_W / 2, maxX: MEMBER_W / 2, minY: -MEMBER_H / 2, maxY: MEMBER_H / 2 }
  const PAD_Y = 12

  for (const n of all) {
    const d = n.data
    const p = { x: x.get(d.id)!, y: yOf(n) }
    const collapsed = !!d.collapsed && d.children.length > 0
    // Unknown mothers are invisible: no card, no branch of their own.
    if (d.unknown) continue
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
    nodes.push(node)
    byId.set(d.id, node)
    const [w, h] = [cardW(d), cardH(d)]
    bounds.minX = Math.min(bounds.minX, p.x - w / 2 - PAD_X)
    bounds.maxX = Math.max(bounds.maxX, p.x + w / 2 + PAD_X)
    bounds.minY = Math.min(bounds.minY, p.y - h / 2 - PAD_Y)
    bounds.maxY = Math.max(bounds.maxY, p.y + h / 2)

    if (!n.parent) continue
    // A child of an unknown mother branches straight from the father.
    const from = limbFrom(n)
    const pp = { x: x.get(from.data.id)!, y: yOf(from) }
    /*
     * One smooth limb: it leaves the parent heading up (the way the parent's own limb grew) and reaches
     * the child from below, so it never runs along a row. The rows give far-reaching limbs extra height
     * (CLIMB), so they climb at a slant instead of running flat.
     */
    // On a staggered row a limb runs straight up through the gap between the cards beside its card,
    // and only bends while it is clear of the row: up past the upper tier when it leaves a lower-tier
    // card, up from below the lower tier when it reaches an upper-tier one.
    const sunk = tiered[from.depth] && !lift.has(from.data.id)
    const lifted = lift.has(d.id)
    const s0 = sunk ? { x: pp.x, y: pp.y - TIER_RISE - MEMBER_H / 2 } : pp
    const s1 = lifted ? { x: p.x, y: p.y + TIER_RISE + MEMBER_H / 2 } : p
    const len = Math.hypot(s1.x - s0.x, s1.y - s0.y) || 1
    const [dx, dy] = [(s1.x - s0.x) / len, (s1.y - s0.y) / len]
    // The founder's limbs leave the trunk top straight up.
    const [ox, oy] = sunk ? [0, -1] : (arrival.get(from.data.id) ?? (from.parent ? outward(pp) : [0, -1]))
    const [ex, ey] = lifted ? [0, -1] : outward(p)
    // The further a limb reaches sideways for its rise, the straighter up it leaves and arrives, so it
    // crosses between the rows rather than along them under its neighbours' cards.
    const flat = Math.max(1, Math.abs(s1.x - s0.x) / Math.max(s0.y - s1.y, 1) / 10)
    const [ax, ay] = unit(dx + ox * LEAVE_UP * flat, dy + oy * LEAVE_UP * flat)
    const [bx, by] = lifted ? [0, -1] : unit(ex + (dx * ARRIVE_LEAN) / flat, ey + (dy * ARRIVE_LEAN) / flat)
    arrival.set(d.id, [bx, by])
    // A long limb to the side bends only as far as it rises, or it would bulge over the next row.
    const bend = Math.max(0, Math.min(len * LIMB_BEND, (s0.y - s1.y) * RISE_BEND))
    const c1: Point = [s0.x + ax * bend, s0.y + ay * bend]
    const c2: Point = [s1.x - bx * bend, s1.y - by * bend]
    const centre: Point[] = sunk ? [[pp.x, pp.y], [pp.x, (pp.y + s0.y) / 2]] : []
    for (let i = 0; i <= BRANCH_SAMPLES; i++) {
      const t = i / BRANCH_SAMPLES
      const mt = 1 - t
      const [a, b, c, e] = [mt * mt * mt, 3 * mt * mt * t, 3 * mt * t * t, t * t * t]
      centre.push([a * s0.x + b * c1[0] + c * c2[0] + e * s1.x, a * s0.y + b * c1[1] + c * c2[1] + e * s1.y])
    }
    if (lifted) centre.push([p.x, (p.y + s1.y) / 2], [p.x, p.y])

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

  return { nodes, links, byId, bounds, crown: crownBlobs(nodes, Math.max(top, bounds.maxX - bounds.minX)), rings, trunkScale }
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
