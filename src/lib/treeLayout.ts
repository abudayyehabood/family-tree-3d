import { hierarchy } from 'd3-hierarchy'
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

/**
 * One colour per generation (the founder's is 1). Neighbouring generations jump far round the colour
 * wheel (red, teal, magenta, lime...), so a parent and child, or two cousins a generation apart, never look alike.
 */
export const GEN_COLOURS = ['#78350f', '#dc2626', '#0d9488', '#c026d3', '#65a30d', '#4338ca', '#ea580c', '#0284c7', '#db2777', '#15803d', '#7e22ce', '#ca8a04', '#1d4ed8', '#334155', '#be123c', '#0f766e']
export const genColour = (generation: number) => GEN_COLOURS[(generation - 1) % GEN_COLOURS.length]

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

/** Screen size (px) of the name tags shown over the dots far out. */
export const NAME_TAG_PX = 13

/** Zoomed out, the fold badge grows so it is never under BADGE_PX tall on screen (up to BADGE_GROW times). */
const BADGE_PX = 20
const BADGE_GROW = 3
export const badgeScale = (k: number) => Math.min(BADGE_GROW, Math.max(1, BADGE_PX / (BADGE_H * k)))

/**
 * What a tap at world point (wx, wy) hits.
 *
 * Done by geometry rather than by reading the event target: both Safari and Chromium apply
 * fat-finger "touch adjustment" that silently retargets a tap onto the nearest small clickable
 * element, and at the zoom that fits a whole tree on a phone a card is ~36px wide while its
 * collapse badge is ~6px — so taps meant for a card were being stolen by the badge.
 *
 * `pad` (world units) widens the card boxes so small cards stay easy to hit; the badge is never
 * padded, so it only wins on a deliberate hit and the card wins in every ambiguous case. `grow` is how many
 * times bigger badges are drawn at this zoom; 0 when they are hidden.
 */
export function hitTest(nodes: LayoutNode[], wx: number, wy: number, pad: number, grow = 1): { node: LayoutNode; badge: boolean } | null {
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
  // Zoomed out a badge is drawn `grow` times bigger, growing up and out from its bottom inner corner
  // (see `.badge-body`), and it may stick out past its card: it is hit where and as big as it is drawn.
  if (grow > 0)
    for (const n of nodes) {
      if (!n.childCount) continue
      const b = badgeBox(n.type, n.collapsed, n.hiddenCount)
      const [bx, by] = [n.x + b.cx - (grow - 1) * b.hw, n.y + b.cy - (grow - 1) * b.hh]
      if (Math.abs(wx - bx) <= b.hw * grow && Math.abs(wy - by) <= b.hh * grow) return { node: n, badge: true }
    }
  return best && { node: best, badge: false }
}

/** Husband → wife: short branch. */
export const WIFE_STEP = 85
/** Mother → child: slightly longer branch. */
export const CHILD_STEP = 140

/** Room kept round every card. */
const PAD_X = 8

/*
 * Organic crown: no rows. Every piece of wood is straight and about the same length; children sprout
 * along their parent's stem like shoots on a branch. Every piece gets its own small, fixed tilt and
 * length (from its id), so no two forks look alike and the crown is never mirror-symmetric. Cards that still collide push their families
 * apart: the two limbs they hang from swing away from each other until nothing touches. Every limb
 * is about the same length (within STRETCH of it); where swinging is not enough, all of them grow together.
 */
/** No limb leans further than this from straight up (radians), so every branch climbs. */
const MAX_LEAN = 1.25
/** Every limb is the same length, give or take this fraction (a limb only grows longer to clear a family). */
const STRETCH = 0.2
/** Length of every limb (give or take STRETCH). */
const LIMB = 220
/** A limb is never thicker than this fraction of its length, so it reads as a limb, not a knot. */
const LIMB_THICK = 0.4
/** Clear room between any two families, cards or wood. */
const GAP = 24
/** Height of a band in a family's profile (world units). */
const ROW = 20
/** How many bands higher than its natural length a limb may try, to find a place that costs less room. */
const HEIGHT_TRIES = 80
/** Limbs leave a card from one fork and may share wood this far (world units) above the card. */
const FORK = 90

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
/** Widest a branch may end under a card that nothing grows from. */
const LEAF_TIP = MEMBER_H * 0.5
/** Cards on show for each step up in trunk scale (the trunk scales with the square root of the count). */
const TRUNK_CARDS = 40

/** A limb bows gently to one side by at most this much (world units), never winds. */
const BOW = 8

/** Points sampled along each branch's centre-line. */
const BRANCH_SAMPLES = 8

/** Fixed number in [-1, 1] for an id, so a family keeps its own tilt from one render to the next. */
function wobble(id: string, salt: number): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  h = Math.imul(h ^ (h >>> 15), 2246822507)
  h ^= h >>> 13
  return ((h >>> 0) / 4294967295) * 2 - 1
}

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
  /** Each generation's label, level with its row: `x` is the right edge of the one left of the crown, `xr` the left edge of the one right of it. */
  rings: Array<{ generation: number; x: number; xr: number; y: number }>
  /** Trunk scale (1 for normal families, grows for big crowns so the trunk stays proportional). */
  trunkScale: number
}

const cardW = (n: TreeNode) => (n.unknown ? 0 : 2 * cardHalf(n.type, !!n.husband).hw)
const cardH = (n: TreeNode) => (n.unknown ? 0 : 2 * cardHalf(n.type, !!n.husband).hh)

/** Width of every branch of one generation (the founder's equals the trunk top). */
const limbWidth = (generation: number, trunkScale: number) => Math.max(MIN_LIMB, TRUNK_TOP * trunkScale * TAPER ** (generation - 1))

export function computeLayout(data: TreeNode, index: TreeIndex): TreeLayout {
  const root = hierarchy(data, (d) => (d.collapsed ? null : d.children))
  const all = root.descendants()


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

  /** Cards on show on a branch: the card and everyone open above it. */
  const size = new Map<HierarchyNode<TreeNode>, number>()
  for (const n of [...all].reverse()) size.set(n, (n.data.unknown ? 0 : 1) + (n.children ?? []).reduce((s, k) => s + size.get(k)!, 0))
  /** A card's children as drawn: an unknown mother's children grow from her husband. */
  const kidsOf = (n: HierarchyNode<TreeNode>): Array<HierarchyNode<TreeNode>> => (n.children ?? []).flatMap((k) => (k.data.unknown ? kidsOf(k) : [k]))

  /*
   * No two branches ever cross. Every family is laid out on its own first: its card, and its children's
   * families packed round it. A family keeps a profile, how far left and right it reaches in each band
   * of height. The biggest child's family goes straight up; each other one goes out to the left or the
   * right of everything placed so far, on a straight limb that climbs from the parent and clears it all,
   * wherever that costs the least room. So every branch climbs, and families never mix.
   */
  interface Shape {
    lo: number
    L: number[]
    R: number[]
  }
  const rowL = (s: Shape, k: number) => s.L[k - s.lo] ?? Infinity
  const rowR = (s: Shape, k: number) => s.R[k - s.lo] ?? -Infinity
  const rowTop = (s: Shape) => s.lo + s.L.length - 1
  const widen = (s: Shape, k: number, l: number, r: number) => {
    while (k < s.lo) s.lo--, s.L.unshift(Infinity), s.R.unshift(-Infinity)
    while (k - s.lo >= s.L.length) s.L.push(Infinity), s.R.push(-Infinity)
    const i = k - s.lo
    s.L[i] = Math.min(s.L[i], l)
    s.R[i] = Math.max(s.R[i], r)
  }
  const reach = (s: Shape, side: 1 | -1) => s.L.reduce((m, _, i) => Math.max(m, side > 0 ? s.R[i] : -s.L[i]), -Infinity)

  /** Where each card sits relative to the card it grows from. */
  const offset = new Map<HierarchyNode<TreeNode>, [number, number]>()
  const lean = Math.tan(MAX_LEAN)
  const pack = (n: HierarchyNode<TreeNode>): Shape => {
    const s: Shape = { lo: 0, L: [], R: [] }
    const { hw, hh } = cardHalf(n.data.type, !!n.data.husband)
    for (let k = Math.floor(-(hh + GAP / 2) / ROW); k <= Math.floor((hh + GAP / 2) / ROW); k++) widen(s, k, -hw - GAP / 2, hw + GAP / 2)
    const kids = kidsOf(n)
    if (!kids.length) return s
    // Limbs fan out of one fork, like a real tree's: near the card they may share wood (straight limbs
    // from one point never cross), so they are only kept apart once they are well clear of it.
    const free = Math.ceil((hh + GAP + FORK) / ROW)
    const lead = kids.reduce((best, k) => (size.get(k)! > size.get(best)! ? k : best), kids[0])
    for (const k of [lead, ...kids.filter((c) => c !== lead)]) {
      const c = pack(k)
      const wb = thick(baseWidth(k)) / 2 + GAP / 2
      const h0 = Math.ceil((limb * (1 - STRETCH / 2 + (wobble(k.data.id, 2) * STRETCH) / 2)) / ROW)
      let best: { x: number; hk: number; cost: number } | null = null
      for (const side of k === lead ? ([1] as const) : ([1, -1] as const)) {
        // Mirrored so the family always goes out to the right: sr is how far right the parent's family
        // reaches in a band, cl how far left the child's does.
        const sr = (r: number) => (side > 0 ? rowR(s, r) : -rowL(s, r))
        const cl = (r: number) => (side > 0 ? rowL(c, r) : -rowR(c, r))
        const [far, cFar, sTop, cTop] = [reach(s, side), reach(c, side), rowTop(s), rowTop(c)]
        for (let hk = h0; hk <= h0 + HEIGHT_TRIES; hk++) {
          let x = 0
          for (let j = c.lo; j <= cTop; j++) x = Math.max(x, sr(j + hk) - cl(j))
          for (let r = free; r < hk; r++) x = Math.max(x, ((sr(r) + wb) * hk) / r)
          // A limb leaning flatter than MAX_LEAN is a last resort: it still climbs and still clears everything.
          const flat = Math.max(0, x - lean * hk * ROW)
          const cost = Math.max(0, x + cFar - far) + Math.max(0, hk + cTop - sTop) * ROW + 0.25 * Math.hypot(x, hk * ROW) + 20 * flat
          if (!best || cost < best.cost) best = { x: side * x, hk, cost }
        }
      }
      const { x, hk } = best!
      for (let j = c.lo; j <= rowTop(c); j++) if (c.L[j - c.lo] <= c.R[j - c.lo]) widen(s, j + hk, x + rowL(c, j), x + rowR(c, j))
      for (let r = 0; r < hk; r++) {
        const [a, b] = [(x * r) / hk, (x * (r + 1)) / hk]
        widen(s, r, Math.min(a, b) - wb, Math.max(a, b) + wb)
      }
      offset.set(k, [x, -hk * ROW])
    }
    return s
  }

  /** The one length of every limb (give or take STRETCH; longer only where a family needs the room). */
  const limb = Math.max(LIMB, ...all.filter((n) => !n.data.unknown).map((n) => cardH(n.data) + 2 * PAD_X))
  const thick = (w: number) => Math.min(w, limb * LIMB_THICK)
  pack(root)

  const x = new Map<string, number>([[root.data.id, 0]])
  const y = new Map<string, number>([[root.data.id, 0]])
  for (const n of all) {
    if (!n.parent) continue
    const from = limbFrom(n)
    const [dx, dy] = n.data.unknown ? [0, 0] : offset.get(n)!
    x.set(n.data.id, x.get(from.data.id)! + dx)
    y.set(n.data.id, y.get(from.data.id)! + dy)
  }
  const yOf = (n: HierarchyNode<TreeNode>) => y.get(n.data.id)!
  const top = -Math.min(...all.map(yOf))
  const nodes: LayoutNode[] = []
  const links: LayoutLink[] = []
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
    // One straight limb from the parent, with the slightest bow (well inside the room kept round it).
    const [dx, dy] = [p.x - pp.x, p.y - pp.y]
    const bow = (wobble(d.id, 4) * Math.min(BOW, GAP / 3)) / (Math.hypot(dx, dy) || 1)
    const centre: Point[] = []
    for (let i = 0; i <= BRANCH_SAMPLES; i++) {
      const t = i / BRANCH_SAMPLES
      const off = bow * 4 * t * (1 - t)
      centre.push([pp.x + dx * t - dy * off, pp.y + dy * t + dx * off])
    }

    // A branch starts a little wider than the family it carries (never wider than its parent) and ends at that width.
    const w0 = thick(baseWidth(n))
    // A branch nobody grows from (no children, or folded away) runs out to a twig under its card
    // instead of ending in a sawn-off stump wider than the card.
    const tip = d.children.length === 0 || collapsed
    const w1 = thick(tip ? Math.min(branchWidth(n), LEAF_TIP) : branchWidth(n))
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

  // Generations no longer sit in rows; each has its own colour instead (see GEN_COLOURS).
  const rings: TreeLayout['rings'] = []

  return { nodes, links, byId, bounds, crown: crownBlobs(nodes, links, Math.max(top, bounds.maxX - bounds.minX)), rings, trunkScale }
}

/**
 * Leafy crown that follows the real branches: cards and the middles of limbs are binned on a coarse grid
 * and every occupied cell gets one big soft blob, so the canopy leans and gaps where the tree does. (With
 * cards alone, a long limb crossing an empty stretch left a bare hole in the leaves.)
 */
function crownBlobs(nodes: LayoutNode[], links: LayoutLink[], outer: number): CrownBlob[] {
  const cell = Math.max(320, outer / 7)
  const bins = new Map<string, { x: number; y: number; n: number }>()
  // Leaves start where the trunk forks: none on the founder's wives or on the limbs up to his sons,
  // or the canopy hangs down round the trunk to the ground.
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const points = nodes.filter((n) => n.generation > 1).map(({ x, y }) => ({ x, y }))
  for (const { id, spine } of links) {
    if (byId.get(id)!.generation <= 2) continue
    const [x, y] = spine[spine.length >> 1]
    points.push({ x, y })
  }
  for (const { x, y } of points) {
    const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`
    const bin = bins.get(key) ?? { x: 0, y: 0, n: 0 }
    bin.x += x
    bin.y += y
    bin.n++
    bins.set(key, bin)
  }
  // …and no blob sags more than half its size below the founder's sons.
  const sons = nodes.filter((n) => n.generation === 2).map((n) => n.y)
  const floor = sons.length ? Math.max(...sons) : Infinity
  return [...bins.values()].map(({ x, y, n }) => {
    const r = cell * (0.75 + 0.1 * Math.min(3, n - 1))
    return { cx: x / n, cy: Math.min(y / n, floor - r / 2), r }
  })
}
