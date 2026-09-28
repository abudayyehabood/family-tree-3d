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

/** Collapse badge: 22 world units tall, anchored on the card's top leading corner. */
const BADGE_H = 22
const BADGE_MIN_W = 22

/** Half-extents of a card, in world units. */
export function cardHalf(type: NodeType): { hw: number; hh: number } {
  return type === 'wife' ? { hw: WIFE_W / 2, hh: WIFE_H / 2 } : { hw: MEMBER_W / 2, hh: MEMBER_H / 2 }
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
    const { hw, hh } = cardHalf(n.type)
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

/** Arc length reserved per card on a ring (from the spec). */
const WIFE_ARC = 130
const MEMBER_ARC = 150
/**
 * Straight-line distance two neighbours on one ring keep at least; slightly above the diagonal of
 * the padded cards used by the collision test, so same-ring cards can never touch.
 */
const WIFE_CHORD = 134
const MEMBER_CHORD = 152
/** Extra room around each card in the collision test (the +/− badge pokes out of the top edge). */
const PAD_X = 8
const PAD_Y = 12

const DEG = Math.PI / 180
const MAX_THETA = 72 * DEG
/** Small families still fan out at least this wide. */
const MIN_SPREAD = 50 * DEG
/** Neighbours with different parents keep a little more room than siblings. */
const COUSIN_GAP = 1.25
/**
 * The tidy tree may be squeezed to this fraction of its natural width to fit inside ±72°; each ring is
 * then relaxed so cards keep their gap. Lower = more compact canopy but children drift further from
 * their parents.
 */
const MIN_SQUEEZE = 0.5
/** How much the whole canopy grows per retry while cards still collide. */
const SCALE_BUMP = 1.04
const MAX_ATTEMPTS = 80
const RELAX_ITERATIONS = 10

/** Points sampled along each branch's polar sweep. */
const BRANCH_SAMPLES = 16

/** Rings with at least this many cards are split into two staggered lanes. */
const LANE_MIN_COUNT = 10
/** Radial gap between the two lanes of a crowded ring, on top of the card height and padding. */
const LANE_GAP = 22
/** Branch width grows with the square root of the people it carries (the "pipe model" of real trees). */
const LIMB_PER_SQRT_PERSON = 2.4
const MAX_LIMB = 44
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

const cardW = (n: TreeNode) => (n.unknown ? 0 : n.type === 'wife' ? WIFE_W : MEMBER_W)
const cardH = (n: TreeNode) => (n.unknown ? 0 : n.type === 'wife' ? WIFE_H : MEMBER_H)

function collides(a: Polar, b: Polar): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + PAD_X && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + PAD_Y
}

/**
 * Depths whose own lanes clash (two neighbours on one ring), plus -1 when cards on different rings
 * touch. Uses a coarse grid so large trees stay fast.
 */
function findCollisions(all: HierarchyNode<TreeNode>[], polar: Map<string, Polar>): Set<number> {
  const CELL = 200
  const grid = new Map<string, Array<{ p: Polar; depth: number }>>()
  const result = new Set<number>()
  for (const n of all) {
    const p = polar.get(n.data.id)!
    if (!p.w) continue
    const cx = Math.floor(p.x / CELL)
    const cy = Math.floor(p.y / CELL)
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cy - 1; j <= cy + 1; j++) {
        for (const q of grid.get(`${i},${j}`) ?? []) {
          if (collides(p, q.p)) result.add(q.depth === n.depth ? n.depth : -1)
        }
      }
    }
    const key = `${cx},${cy}`
    const cell = grid.get(key)
    if (cell) cell.push({ p, depth: n.depth })
    else grid.set(key, [{ p, depth: n.depth }])
  }
  return result
}

/**
 * Pushes neighbouring angles apart until every gap is at least `minDelta`, then re-centres the ring on
 * its original mean angle and keeps it inside ±72°. `thetas` must be sorted ascending.
 */
function relaxAngles(thetas: number[], minDelta: number): number[] {
  const t = [...thetas]
  const n = t.length
  if (n < 2) return t
  const mean = t.reduce((s, v) => s + v, 0) / n
  for (let it = 0; it < RELAX_ITERATIONS; it++) {
    for (let i = 0; i < n - 1; i++) {
      const gap = t[i + 1] - t[i]
      if (gap < minDelta) {
        const push = (minDelta - gap) / 2
        t[i] -= push
        t[i + 1] += push
      }
    }
  }
  // Guarantee the minimum gap exactly (the relaxation may still leave tiny deficits on crowded rings).
  for (let i = 1; i < n; i++) t[i] = Math.max(t[i], t[i - 1] + minDelta)
  const shift = mean - t.reduce((s, v) => s + v, 0) / n
  for (let i = 0; i < n; i++) t[i] += shift
  if (t[0] < -MAX_THETA) {
    const d = -MAX_THETA - t[0]
    for (let i = 0; i < n; i++) t[i] += d
  } else if (t[n - 1] > MAX_THETA) {
    const d = t[n - 1] - MAX_THETA
    for (let i = 0; i < n; i++) t[i] -= d
  }
  return t
}

/** Angle between two points on a circle of radius r whose straight-line distance is `chord`. */
const chordAngle = (chord: number, r: number) => 2 * Math.asin(Math.min(1, chord / (2 * r)))

interface Ring {
  /** Radius of the inner lane is `stepSum * scale + laneSum`. */
  stepSum: number
  laneSum: number
  lanes: 1 | 2
  laneOffset: number
  minArc: number
  minChord: number
  /** False for a ring made only of unknown mothers, which takes no space. */
  visible: boolean
}

/**
 * Upward polar canopy layout.
 * Every depth is a ring around the founder, evenly spaced (wives a short step out, children a longer
 * one) and crowded rings split into two staggered lanes. d3.tree() then works directly in angles,
 * with each ring's own minimum gap as the separation: a tidy tree keeps every parent centred over its
 * children, so branches stay short and never cross. The whole canopy is scaled up until it fits
 * inside ±72° and no two cards touch.
 */
export function computeLayout(data: TreeNode, index: TreeIndex): TreeLayout {
  const root = hierarchy(data, (d) => (d.collapsed ? null : d.children))
  const all = root.descendants()

  const levels: Placed[][] = []
  for (const n of all) (levels[n.depth] ??= []).push(n as Placed)
  /** Position among the visible cards of its ring, left to right (drives the lane choice). */
  const laneIndex = new Map<string, number>()
  const rings: Ring[] = []
  let stepSum = 0
  let laneSum = 0
  levels.forEach((ring, depth) => {
    const cards = ring.filter((n) => !n.data.unknown)
    cards.forEach((n, k) => laneIndex.set(n.data.id, k))
    const isWife = cards[0]?.data.type === 'wife'
    const visible = depth > 0 && cards.length > 0
    if (visible) stepSum += isWife ? WIFE_STEP : CHILD_STEP
    const lanes = cards.length >= LANE_MIN_COUNT ? 2 : 1
    const laneOffset = lanes === 2 ? (isWife ? WIFE_H : MEMBER_H) + PAD_Y + LANE_GAP : 0
    rings.push({
      stepSum,
      laneSum,
      lanes,
      laneOffset,
      minArc: isWife ? WIFE_ARC : MEMBER_ARC,
      minChord: isWife ? WIFE_CHORD : MEMBER_CHORD,
      visible,
    })
    laneSum += laneOffset
  })

  let scale = 1
  /** Fraction of the single-lane gap neighbours keep: two lanes start at half, widened where they clash. */
  const gapFactor = rings.map((r) => 1 / r.lanes)
  const gaps: number[] = new Array(rings.length).fill(0)
  const layoutTree = tree<TreeNode>()
    .nodeSize([1, 1])
    .separation((a, b) => {
      const g = gaps[a.depth]
      if (a.data.unknown || b.data.unknown) return g * 0.5
      return a.parent === b.parent ? g : g * COUSIN_GAP
    })

  let polar = new Map<string, Polar>()
  let outerRadius = 0
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    rings.forEach((ring, d) => {
      const r = ring.stepSum * scale + ring.laneSum
      gaps[d] = ring.visible ? Math.max(ring.minArc / r, chordAngle(ring.minChord, r)) * gapFactor[d] : 0
    })
    layoutTree(root)
    let minX = Infinity
    let maxX = -Infinity
    for (const n of all) {
      minX = Math.min(minX, n.x!)
      maxX = Math.max(maxX, n.x!)
    }
    const span = maxX - minX
    // Squeezing a much wider tree would make the ring relaxation drag children far from their parents.
    const maxSpan = (2 * MAX_THETA) / MIN_SQUEEZE
    if (span > maxSpan) {
      scale *= Math.max(SCALE_BUMP, Math.sqrt(span / maxSpan))
      continue
    }
    const mid = (minX + maxX) / 2
    // Squeeze into ±72° (the rings are then relaxed below), or fan small families out a little.
    const fit = span > 2 * MAX_THETA ? (2 * MAX_THETA) / span : span > 0 && span < MIN_SPREAD ? MIN_SPREAD / span : 1
    // Mirrored: the first-born (smallest d3 x) sits on the right, matching Arabic reading order.
    const toTheta = (x: number) => -(x - mid) * fit

    const thetas = new Map<string, number>()
    let crowded = false
    levels.forEach((level, depth) => {
      const cards = level.filter((n) => !n.data.unknown && n.parent)
      if (!cards.length) return
      if ((cards.length - 1) * gaps[depth] > 2 * MAX_THETA) crowded = true
      const initial = cards.map((n) => toTheta(n.x!)).sort((a, b) => a - b)
      const relaxed = relaxAngles(initial, gaps[depth])
      // `cards` is left to right in d3 order, i.e. descending angle.
      cards.forEach((n, k) => thetas.set(n.data.id, relaxed[cards.length - 1 - k]))
    })
    if (crowded) {
      scale *= SCALE_BUMP
      continue
    }

    polar = new Map()
    outerRadius = 0
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
      const ring = rings[n.depth]
      const r = ring.stepSum * scale + ring.laneSum + ((laneIndex.get(d.id) ?? 0) % 2 ? ring.laneOffset : 0)
      const theta = thetas.get(d.id)!
      polar.set(d.id, { r, theta, x: r * Math.sin(theta), y: -r * Math.cos(theta), w: cardW(d), h: cardH(d) })
      outerRadius = Math.max(outerRadius, r)
    }

    const clash = findCollisions(all, polar)
    if (!clash.size) break
    let grow = false
    for (const depth of clash) {
      if (depth < 0 || gapFactor[depth] >= 1) grow = true
      else gapFactor[depth] = Math.min(1, gapFactor[depth] + 0.1)
    }
    if (grow) scale *= SCALE_BUMP
  }

  const trunkScale = Math.min(6, Math.max(1, outerRadius / 1100))
  /** Width of the trunk top (48px at scale 1), so the founder's limbs grow out of it seamlessly. */
  const limbBaseWidth = 48 * trunkScale * 0.62
  /** Thinnest twig; grows with the tree so outer branches stay visible when zoomed out. */
  const minLimb = Math.max(7, 4 + 1.5 * trunkScale)
  const limbWidth = (id: string) =>
    Math.min(MAX_LIMB, Math.max(minLimb, LIMB_PER_SQRT_PERSON * Math.sqrt((index.get(id)?.descendants ?? 0) + 1)))

  /** Innermost and outermost card radius of every ring (they differ on two-lane rings). */
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
    const pp = polar.get(from.data.id)!
    /*
     * The branch is swept in polar space: it leaves the parent along its radius, and the angle eases
     * from the parent's to the child's only inside the gap between the two rings. Every branch
     * across one gap turns over the same radii, so neighbouring branches keep their order and never
     * cross, even when parent and child sit on different lanes of a staggered ring. (The Cartesian
     * cubic this replaced pulled long sweeps back inside the parent's radius, into the ring below.)
     */
    const gapStart = Math.min(ringOuter[from.depth], p.r)
    const gapEnd = Math.max(gapStart + 1, ringInner[n.depth])
    const centre: Point[] = []
    const add = (r: number) => {
      const u = Math.min(1, Math.max(0, (r - gapStart) / (gapEnd - gapStart)))
      const theta = pp.theta + (p.theta - pp.theta) * (u * u * (3 - 2 * u))
      centre.push([r * Math.sin(theta), -r * Math.cos(theta)])
    }
    if (pp.r < gapStart) add(pp.r)
    for (let i = 0; i <= BRANCH_SAMPLES; i++) add(gapStart + ((gapEnd - gapStart) * i) / BRANCH_SAMPLES)
    if (p.r > gapEnd) add(p.r)

    const isWifeBranch = d.type === 'wife'
    let w0 = limbWidth(d.id)
    const w1 = Math.max(minLimb * 0.75, w0 * 0.6)
    if (!from.parent) w0 = Math.max(w0, limbBaseWidth)
    const pad = w0 / 2
    const xs = centre.map((q) => q[0])
    const ys = centre.map((q) => q[1])
    links.push({
      id: d.id,
      d: taperedPolylinePath(centre, w0, w1),
      kind: isWifeBranch ? 'wife' : 'child',
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

/** A rounded leafy crown: a fan of large overlapping circles covering the whole canopy. */
function crownBlobs(outer: number): CrownBlob[] {
  const R = Math.max(outer, 260)
  const blobs: CrownBlob[] = [{ cx: 0, cy: -R * 0.5, r: R * 0.52 }]
  const steps = 8
  for (let i = 0; i <= steps; i++) {
    const a = (-60 + (120 * i) / steps) * DEG
    blobs.push({ cx: R * 0.66 * Math.sin(a), cy: -R * 0.66 * Math.cos(a), r: R * 0.36 })
    blobs.push({ cx: R * 0.93 * Math.sin(a * 1.08), cy: -R * 0.93 * Math.cos(a * 1.08), r: R * 0.24 })
  }
  return blobs
}
