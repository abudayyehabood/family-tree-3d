import { hierarchy, tree } from 'd3-hierarchy'
import type { HierarchyPointNode } from 'd3-hierarchy'
import type { Gender, NodeType, TreeNode } from '../model'
import { taperedCubicPath } from './geometry'
import type { Point } from './geometry'
import type { TreeIndex } from './tree'

export const MEMBER_W = 130
export const MEMBER_H = 46
export const WIFE_W = 115
export const WIFE_H = 38

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
const RELAX_ITERATIONS = 10
/** How far a ring moves outward per retry while it still collides with the rings below it. */
const RADIUS_BUMP = 12
const MAX_BUMPS = 400

const SEPARATION_SIBLINGS = 1.1
const SEPARATION_COUSINS = 1.5

export interface LayoutNode {
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
  /** People hidden under this node while it is collapsed (0 when expanded). */
  hiddenCount: number
  /** Unknown-mother placeholder, drawn as a small knot. */
  unknown: boolean
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

export function branchThickness(generation: number): number {
  return Math.max(3, 26 * Math.pow(0.8, generation - 1))
}

export const KNOT_SIZE = 34
const cardW = (n: TreeNode) => (n.unknown ? KNOT_SIZE : n.type === 'wife' ? WIFE_W : MEMBER_W)
const cardH = (n: TreeNode) => (n.unknown ? KNOT_SIZE : n.type === 'wife' ? WIFE_H : MEMBER_H)

function collides(a: Polar, b: Polar): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + PAD_X && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + PAD_Y
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

/**
 * Upward polar canopy layout.
 * d3.tree() fixes the left-to-right order (so branches never cross); every depth becomes a ring
 * around the founder, wives 85px and children 140px further out than the ring below. Each ring's
 * radius grows until its cards neither overlap each other nor the rings beneath them.
 */
export function computeLayout(data: TreeNode, index: TreeIndex): TreeLayout {
  const root = hierarchy(data, (d) => (d.collapsed ? null : d.children))
  const laid = tree<TreeNode>()
    .size([1, 1])
    .separation((a, b) => (a.parent === b.parent ? SEPARATION_SIBLINGS : SEPARATION_COUSINS))(root)

  const L = laid.leaves().length
  const maxSpread = Math.min(130 * DEG, Math.max(50 * DEG, L * 0.18))

  const levels: Placed[][] = []
  let minUnit = Infinity
  let maxUnit = -Infinity
  laid.each((n) => {
    ;(levels[n.depth] ??= []).push(n)
    minUnit = Math.min(minUnit, n.x)
    maxUnit = Math.max(maxUnit, n.x)
  })
  const unitRange = maxUnit - minUnit
  // Mirrored: the first-born (smallest d3 x) sits on the right, matching Arabic reading order.
  const unitToTheta = (x: number) => (unitRange > 0 ? (0.5 - (x - minUnit) / unitRange) * maxSpread : 0)

  const polar = new Map<string, Polar>()
  polar.set(data.id, { r: 0, theta: 0, x: 0, y: 0, w: MEMBER_W, h: MEMBER_H })
  const placedRings: Polar[][] = [[polar.get(data.id)!]]
  let prevRadius = 0

  for (let depth = 1; depth < levels.length; depth++) {
    const ring = levels[depth]
    const count = ring.length
    const isWife = ring[0].data.type === 'wife'
    const step = isWife ? WIFE_STEP : CHILD_STEP
    const minArc = isWife ? WIFE_ARC : MEMBER_ARC
    const minChord = isWife ? WIFE_CHORD : MEMBER_CHORD
    const initial = ring.map((n) => (count === 1 ? polar.get(n.parent!.data.id)!.theta : unitToTheta(n.x)))
    // Sorted ascending by angle; ring order is the d3 order reversed because of the mirroring.
    const order = ring.map((_, i) => i).sort((a, b) => initial[a] - initial[b])
    const sortedInitial = order.map((i) => initial[i])

    let radius = Math.max(prevRadius + step, count > 1 ? (count * minArc) / maxSpread : prevRadius + step)
    // The whole ring must fit inside ±72°.
    while (count > 1 && (count - 1) * chordAngle(minChord, radius) > 2 * MAX_THETA) radius += RADIUS_BUMP

    const below = placedRings.flat()
    let placed: Polar[] = []
    for (let attempt = 0; attempt <= MAX_BUMPS; attempt++) {
      const minDelta = Math.max(minArc / radius, chordAngle(minChord, radius))
      const thetas = relaxAngles(sortedInitial, minDelta)
      placed = new Array<Polar>(count)
      order.forEach((ringIndex, k) => {
        const theta = thetas[k]
        const n = ring[ringIndex].data
        placed[ringIndex] = {
          r: radius,
          theta,
          x: radius * Math.sin(theta),
          y: -radius * Math.cos(theta),
          w: cardW(n),
          h: cardH(n),
        }
      })
      // Only rings closer than a card diagonal can collide with this one.
      const near = below.filter((p) => radius - p.r < 160)
      if (!placed.some((p) => near.some((q) => collides(p, q)))) break
      radius += RADIUS_BUMP
    }

    ring.forEach((n, i) => polar.set(n.data.id, placed[i]))
    placedRings.push(placed)
    prevRadius = radius
  }

  const outerRadius = prevRadius
  const trunkScale = Math.min(6, Math.max(1, outerRadius / 1100))
  /** Width of the trunk top (48px at scale 1), so the founder's limbs grow out of it seamlessly. */
  const limbBaseWidth = 48 * trunkScale * 0.62

  const nodes: LayoutNode[] = []
  const links: LayoutLink[] = []
  const byId = new Map<string, LayoutNode>()
  const bounds: Box = { minX: -MEMBER_W / 2, maxX: MEMBER_W / 2, minY: -MEMBER_H / 2, maxY: MEMBER_H / 2 }

  laid.each((n) => {
    const d = n.data
    const p = polar.get(d.id)!
    const collapsed = !!d.collapsed && d.children.length > 0
    const node: LayoutNode = {
      id: d.id,
      type: d.type,
      gender: d.gender,
      name: d.name,
      generation: d.generation,
      x: p.x,
      y: p.y,
      isRoot: !n.parent,
      collapsed,
      childCount: d.children.length,
      hiddenCount: collapsed ? (index.get(d.id)?.descendants ?? 0) : 0,
      unknown: !!d.unknown,
    }
    nodes.push(node)
    byId.set(d.id, node)
    bounds.minX = Math.min(bounds.minX, p.x - p.w / 2 - PAD_X)
    bounds.maxX = Math.max(bounds.maxX, p.x + p.w / 2 + PAD_X)
    bounds.minY = Math.min(bounds.minY, p.y - p.h / 2 - PAD_Y)
    bounds.maxY = Math.max(bounds.maxY, p.y + p.h / 2)

    if (!n.parent) return
    const pp = polar.get(n.parent.data.id)!
    const P: Point = [pp.x, pp.y]
    const C: Point = [p.x, p.y]
    const dr = p.r - pp.r
    const childDir: Point = [Math.sin(p.theta), -Math.cos(p.theta)]
    // Branches leave the parent along its own radius (straight up for the founder) and arrive along
    // the child's radius, so every branch bends smoothly upward and outward.
    const parentDir: Point = n.parent.parent ? [Math.sin(pp.theta), -Math.cos(pp.theta)] : [0, -1]
    const c1: Point = [P[0] + parentDir[0] * dr * 0.5, P[1] + parentDir[1] * dr * 0.5]
    const c2: Point = [C[0] - childDir[0] * dr * 0.45, C[1] - childDir[1] * dr * 0.45]

    const isWifeBranch = d.type === 'wife' && !d.unknown
    const parentGen = n.parent.data.generation
    const base = branchThickness(parentGen)
    let w0 = isWifeBranch ? base : base * 0.8
    if (!n.parent.parent) w0 = Math.max(w0, limbBaseWidth)
    const w1 = Math.max(2.5, isWifeBranch ? base * 0.62 : branchThickness(d.generation) * 0.55)
    const pad = w0 / 2
    const xs = [P[0], c1[0], c2[0], C[0]]
    const ys = [P[1], c1[1], c2[1], C[1]]
    links.push({
      id: d.id,
      d: taperedCubicPath(P, c1, c2, C, w0, w1),
      kind: isWifeBranch ? 'wife' : 'child',
      box: {
        minX: Math.min(...xs) - pad,
        minY: Math.min(...ys) - pad,
        maxX: Math.max(...xs) + pad,
        maxY: Math.max(...ys) + pad,
      },
    })
  })

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
