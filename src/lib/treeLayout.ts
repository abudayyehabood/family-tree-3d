import { forceLink, forceManyBody, forceSimulation } from 'd3-force'
import type { SimulationNodeDatum } from 'd3-force'
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

/** One colour per generation (the founder's is 1), so a generation reads at a glance without rows. */
export const GEN_COLOURS = ['#7c2d12', '#15803d', '#0369a1', '#7e22ce', '#b45309', '#be123c', '#0f766e', '#4338ca', '#a16207', '#c2410c', '#1d4ed8', '#9d174d', '#3f6212', '#6d28d9', '#0e7490', '#854d0e']
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
/** A side twig leaves its stem at this angle (radians). */
const TWIG = 1.0
/** No limb leans further than this from straight up (radians), so the crown never droops. */
const MAX_LEAN = 1.3
/** How much each family's tilt and length are allowed to wander (fraction). */
const WOBBLE = 0.3
/** Every limb is the same length, give or take this fraction. */
const STRETCH = 0.2
/** Length of every piece of wood (give or take STRETCH). */
const LIMB = 220
/** A limb is never thicker than this fraction of its length, so it reads as a limb, not a knot. */
const LIMB_THICK = 0.4
/** How hard touching cards shove each other, and how much room every piece of wood keeps round it. */
const SHOVE = 1.5
const ROOM = 0.5
/** Extra room cards keep while the springs settle, so trimming limbs back to length after leaves none touching. */
const SLACK = 35
/** Steps of letting the wood settle like springs. */
const SIM_TICKS = 300
/** Rounds of trimming the springs back to length and letting the cards settle again. */
const TRIMS = 3
/** Rounds of swinging cards that still touch round their parents (lengths kept). */
const UNTANGLE_ROUNDS = 60
/** Biggest family (pieces of wood) a single untangling swing may carry. */
const UNTANGLE_FAMILY = 150
/** Rounds of pushing colliding families apart. */
const SETTLE_ROUNDS = 60

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

/** A limb bows gently to one side by up to this fraction of its length (never winds). */
const BOW = 0.07

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
   * The wood is a tree of equal pieces. A card with one child grows a single limb to it. A card with
   * several grows a stem: its biggest family carries the stem on to its end, and the others sprout off
   * it one after another as side twigs, left and right in turn, like the shoots along a real branch.
   */
  interface Piece {
    card: HierarchyNode<TreeNode> | null
    parent: Piece | null
    /** Lean from the parent piece's heading (radians), and length as a share of `limb`. */
    rel: number
    f: number
    x: number
    y: number
    heading: number
    key: string
  }
  const pieces: Piece[] = []
  const pieceOf = new Map<HierarchyNode<TreeNode>, Piece>()
  const add = (card: HierarchyNode<TreeNode> | null, parent: Piece | null, rel: number, key: string) => {
    const piece: Piece = { card, parent, rel, f: 1 + wobble(key, 3) * STRETCH * 0.5, x: 0, y: 0, heading: 0, key }
    pieces.push(piece)
    if (card) pieceOf.set(card, piece)
    return piece
  }
  const grow = (n: HierarchyNode<TreeNode>, at: Piece) => {
    const sprouts = kidsOf(n)
    if (!sprouts.length) return
    // Wives hang straight off their husband, one piece each, fanned round his heading, so a wife's
    // limb is as long as any other. Only children sprout along a stem.
    const wives = sprouts.filter((k) => k.data.type === 'wife')
    const fan = wives.length + (sprouts.length > wives.length ? 1 : 0)
    const tilt = wobble(n.data.id, 7) * WOBBLE * 0.4
    wives.forEach((w, i) => {
      const spread = fan > 1 ? (i / (fan - 1) - 0.5) * Math.min(2 * TWIG, 0.7 * (fan - 1)) : 0
      grow(w, add(w, at, tilt + spread + wobble(w.data.id, 2) * WOBBLE * 0.3, w.data.id))
    })
    const kids = sprouts.filter((k) => k.data.type !== 'wife')
    if (!kids.length) return
    const lead = kids.reduce((best, k) => (size.get(k)! > size.get(best)! ? k : best), kids[0])
    // First-born nearest the parent. Side twigs sprout in pairs, one each side of a knot (a lone one
    // on this family's own side), so a big family's stem is half as long.
    const side = wobble(n.data.id, 5) < 0 ? -1 : 1
    const rest = kids.filter((k) => k !== lead)
    let stem = at
    for (let i = 0; i < rest.length; i += 2) {
      stem = add(null, stem, wobble(`${n.data.id}:${i}`, 6) * WOBBLE * 0.4, `${n.data.id}:${i}`)
      rest.slice(i, i + 2).forEach((k, j) => {
        const twig = add(k, stem, (j ? -side : side) * (TWIG + wobble(k.data.id, 2) * WOBBLE * 0.5), k.data.id)
        grow(k, twig)
      })
    }
    grow(lead, add(lead, stem, kids.length === 1 ? wobble(lead.data.id, 2) * WOBBLE * 0.6 : wobble(lead.data.id, 2) * WOBBLE * 0.4, lead.data.id))
  }
  const founder = add(root, null, 0, root.data.id)
  grow(root, founder)

  /** The one length of every piece of wood. */
  const limb = Math.max(LIMB, ...all.filter((n) => !n.data.unknown).map((n) => cardH(n.data) + 2 * PAD_X))
  const thick = (w: number) => Math.min(w, limb * LIMB_THICK)
  const place = () => {
    for (const p of pieces) {
      if (!p.parent) continue
      p.heading = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, p.parent.heading + p.rel))
      p.x = p.parent.x + p.f * limb * Math.sin(p.heading)
      p.y = p.parent.y - p.f * limb * Math.cos(p.heading)
    }
  }
  const lineage = (p: Piece) => {
    const out: Piece[] = []
    for (let at: Piece | null = p; at; at = at.parent) out.push(at)
    return out
  }
  /** The piece just below `top` on the way to `p`. */
  const below = (p: Piece, top: Piece) => {
    let at = p
    while (at.parent && at.parent !== top) at = at.parent
    return at
  }
  /** Width of the wood of a piece: as thick as the families it still carries. */
  const pieceWidth = new Map<Piece, number>()
  for (const p of [...pieces].reverse()) {
    const own = p.card?.parent ? thick(baseWidth(p.card)) : 0
    pieceWidth.set(p, Math.max(own, pieceWidth.get(p) ?? 0))
    if (p.parent) pieceWidth.set(p.parent, Math.max(pieceWidth.get(p.parent) ?? 0, pieceWidth.get(p)!))
  }

  const CELL = 200
  for (let round = 0; round < SETTLE_ROUNDS; round++) {
    place()
    // Things that must not touch: every card, and points along every piece of wood (wood under a card hides it).
    type Item = { p: Piece; cx: number; cy: number; hw: number; hh: number; card: boolean }
    const items: Item[] = []
    for (const p of pieces) {
      if (p.card) {
        const { hw, hh } = cardHalf(p.card.data.type, !!p.card.data.husband)
        items.push({ p, cx: p.x, cy: p.y, hw: hw + PAD_X, hh: hh + PAD_X, card: true })
      }
      if (!p.parent) continue
      const r = pieceWidth.get(p)! / 2 + 2
      for (const t of [0.3, 0.6]) items.push({ p, cx: p.parent.x + (p.x - p.parent.x) * t, cy: p.parent.y + (p.y - p.parent.y) * t, hw: r, hh: r, card: false })
    }
    const grid = new Map<string, Item[]>()
    for (const it of items)
      for (let gx = Math.floor((it.cx - it.hw) / CELL); gx <= Math.floor((it.cx + it.hw) / CELL); gx++)
        for (let gy = Math.floor((it.cy - it.hh) / CELL); gy <= Math.floor((it.cy + it.hh) / CELL); gy++) {
          const key = `${gx},${gy}`
          const cell = grid.get(key)
          if (cell) cell.push(it)
          else grid.set(key, [it])
        }
    const swing = new Map<Piece, number>()
    const stretch = new Map<Piece, number>()
    let hits = 0
    const seen = new Set<string>()
    for (const cell of grid.values())
      for (let i = 0; i < cell.length; i++)
        for (let j = i + 1; j < cell.length; j++) {
          const [a, b] = [cell[i], cell[j]]
          if ((!a.card && !b.card) || a.p === b.p) continue
          const ox = a.hw + b.hw - Math.abs(a.cx - b.cx)
          const oy = a.hh + b.hh - Math.abs(a.cy - b.cy)
          if (ox <= 0 || oy <= 0) continue
          // Wood may touch the card it grows from and the cards right on it.
          const wood = a.card ? b : a
          const card = a.card ? a : b
          if (!wood.card && (card.p === wood.p.parent || card.p.parent === wood.p)) continue
          const key = a.p.key < b.p.key ? `${a.p.key}|${b.p.key}` : `${b.p.key}|${a.p.key}`
          if (seen.has(key)) continue
          seen.add(key)
          hits++
          const up = new Set(lineage(a.p))
          const lca = lineage(b.p).find((m) => up.has(m))!
          const overlap = Math.min(ox, oy) + 2
          if (lca === a.p || lca === b.p) {
            // A card bumps into its own forebear's wood: the piece above the fork stretches.
            const kid = below(lca === a.p ? b.p : a.p, lca)
            stretch.set(kid, Math.max(stretch.get(kid) ?? 0, overlap / limb))
            continue
          }
          const [ca, cb] = [below(a.p, lca), below(b.p, lca)]
          // Swing the two apart round their fork, keeping their order.
          const right = ca.rel > cb.rel || (ca.rel === cb.rel && a.cx > b.cx)
          const reach = Math.max(80, Math.hypot((a.cx + b.cx) / 2 - lca.x, (a.cy + b.cy) / 2 - lca.y))
          const turn = Math.min(0.04, (overlap / reach) * 0.5)
          for (const [c, sign] of [[ca, right ? 1 : -1], [cb, right ? -1 : 1]] as const) {
            // Leaning flat already: stretch instead of swinging further out.
            if (Math.abs(c.heading + sign * turn) > MAX_LEAN) stretch.set(c, Math.max(stretch.get(c) ?? 0, (overlap * 0.5) / limb))
            else swing.set(c, (swing.get(c) ?? 0) + sign * turn)
          }
        }
    if (!hits) break
    for (const [c, t] of swing) c.rel += Math.max(-0.06, Math.min(0.06, t))
    // A piece may stretch to the top of its range, no further.
    for (const [c, g] of stretch) c.f = Math.min(1 + STRETCH, c.f + Math.min(g, 0.1))
  }
  place()
  /*
   * Then everything settles like a real tree: every piece of wood is a spring of its own length, cards
   * and wood shove each other apart, and every piece is pushed to lean up out of its parent. Families
   * slip into the gaps beside them instead of the whole crown swinging.
   */
  type Body = SimulationNodeDatum & { p: Piece }
  const bodies: Body[] = pieces.map((p) => ({ p, x: p.x, y: p.y, ...(p.parent ? {} : { fx: 0, fy: 0 }) }))
  const bodyOf = new Map(bodies.map((b) => [b.p, b]))
  const springs = bodies.filter((b) => b.p.parent).map((b) => ({ source: bodyOf.get(b.p.parent!)!, target: b, f: b.p.f }))
  /** Cards (and points along the wood) that touch are pushed apart along the shorter way out. */
  const shove = (alpha: number) => {
    type Item = { b: Body; from?: Body; t: number; cx: number; cy: number; hw: number; hh: number }
    const items: Item[] = []
    for (const b of bodies) {
      const p = b.p
      if (p.card) {
        const { hw, hh } = cardHalf(p.card.data.type, !!p.card.data.husband)
        items.push({ b, t: 1, cx: b.x!, cy: b.y!, hw: hw + PAD_X + SLACK, hh: hh + PAD_X + SLACK })
      }
      if (!p.parent) continue
      const from = bodyOf.get(p.parent)!
      const r = pieceWidth.get(p)! / 2 + 2
      for (const t of [0.35, 0.65]) items.push({ b, from, t, cx: from.x! + (b.x! - from.x!) * t, cy: from.y! + (b.y! - from.y!) * t, hw: r, hh: r })
    }
    const grid = new Map<string, Item[]>()
    for (const it of items)
      for (let gx = Math.floor((it.cx - it.hw) / CELL); gx <= Math.floor((it.cx + it.hw) / CELL); gx++)
        for (let gy = Math.floor((it.cy - it.hh) / CELL); gy <= Math.floor((it.cy + it.hh) / CELL); gy++) {
          const key = `${gx},${gy}`
          const cell = grid.get(key)
          if (cell) cell.push(it)
          else grid.set(key, [it])
        }
    const seen = new Set<string>()
    const push = (it: Item, dx: number, dy: number) => {
      if (!it.from) {
        it.b.vx! += dx
        it.b.vy! += dy
        return
      }
      it.b.vx! += dx * it.t
      it.b.vy! += dy * it.t
      it.from.vx! += dx * (1 - it.t)
      it.from.vy! += dy * (1 - it.t)
    }
    for (const cell of grid.values())
      for (let i = 0; i < cell.length; i++)
        for (let j = i + 1; j < cell.length; j++) {
          const [a, c] = [cell[i], cell[j]]
          if ((a.from && c.from) || a.b === c.b) continue
          const ox = a.hw + c.hw - Math.abs(a.cx - c.cx)
          const oy = a.hh + c.hh - Math.abs(a.cy - c.cy)
          if (ox <= 0 || oy <= 0) continue
          const wood = a.from ? a : c.from ? c : null
          const card = wood === a ? c : a
          if (wood && (card.b === wood.from || card.b.p.parent === wood.b.p)) continue
          const key = `${a.b.p.key}|${a.t}|${c.b.p.key}|${c.t}`
          if (seen.has(key)) continue
          seen.add(key)
          const k = Math.max(alpha, 0.3) * SHOVE
          const [dx, dy] = ox < oy ? [(a.cx < c.cx ? -1 : 1) * ox * k, 0] : [0, (a.cy < c.cy ? -1 : 1) * oy * k]
          push(a, dx, dy)
          push(c, -dx, -dy)
        }
  }
  /** Every piece leans up out of its parent: never flatter than MAX_LEAN. */
  const lift = (alpha: number) => {
    const rise = Math.cos(MAX_LEAN) * limb
    for (const { source, target } of springs) {
      const short = target.y! - (source.y! - rise)
      if (short <= 0) continue
      target.vy! -= short * alpha * 0.5
      source.vy! += short * alpha * 0.25
    }
  }
  const sim = forceSimulation(bodies)
    .stop()
    .velocityDecay(0.35)
    .force('wood', forceLink(springs).distance((l) => limb * l.f).strength(0.9).iterations(2))
    .force('room', forceManyBody<Body>().strength(-limb * ROOM).distanceMax(limb * 3))
    .force('shove', shove)
    .force('lift', lift)
  sim.tick(SIM_TICKS)
  // Cool down with the shoving alone and the springs, so nothing is left touching.
  sim.force('room', null).alpha(0.3).alphaDecay(0)
  sim.tick(SIM_TICKS / 3)
  /** Springs give a little: pull any piece back within STRETCH of its length, its family along with it. */
  const trim = () => {
    for (const b of bodies) (b.p.x = b.x!), (b.p.y = b.y!)
    const shift = new Map<Piece, [number, number]>()
    for (const p of pieces) {
      const [ux, uy] = p.parent ? shift.get(p.parent)! : [0, 0]
      p.x += ux
      p.y += uy
      if (p.parent) {
        const [dx, dy] = [p.x - p.parent.x, p.y - p.parent.y]
        const d = Math.hypot(dx, dy) || 1
        const want = Math.max((1 - STRETCH) * limb, Math.min((1 + STRETCH) * limb, d))
        const [mx, my] = [(dx / d) * (want - d), (dy / d) * (want - d)]
        p.x += mx
        p.y += my
        shift.set(p, [ux + mx, uy + my])
      } else shift.set(p, [0, 0])
    }
    for (const b of bodies) if (b.p.parent) (b.x = b.p.x), (b.y = b.p.y), (b.vx = 0), (b.vy = 0)
  }
  /**
   * Trimming moves whole families, so a few cards end up touching again. Each such card (or, failing
   * that, a bough below it) swings round the card it hangs from, carrying its family, but only when the
   * swing leaves less overlap and the limb still climbs. A swing changes no limb's length.
   */
  const untangle = () => {
    const kidsOfPiece = new Map<Piece, Piece[]>()
    for (const p of pieces) if (p.parent) kidsOfPiece.set(p.parent, [...(kidsOfPiece.get(p.parent) ?? []), p])
    const familyOf = (p: Piece) => {
      const out: Piece[] = []
      const stack = [p]
      while (stack.length) {
        const q = stack.pop()!
        out.push(q)
        stack.push(...(kidsOfPiece.get(q) ?? []))
      }
      return out
    }
    const swing = (family: Piece[], ox: number, oy: number, angle: number) => {
      const [c, sn] = [Math.cos(angle), Math.sin(angle)]
      for (const q of family) {
        const [dx, dy] = [q.x - ox, q.y - oy]
        q.x = ox + dx * c - dy * sn
        q.y = oy + dx * sn + dy * c
      }
    }
    const half = (p: Piece) => cardHalf(p.card!.data.type, !!p.card!.data.husband)
    const cards = pieces.filter((p) => p.card)
    for (let round = 0; round < UNTANGLE_ROUNDS; round++) {
      const grid = new Map<string, Piece[]>()
      for (const p of cards) {
        const key = `${Math.floor(p.x / CELL)},${Math.floor(p.y / CELL)}`
        const cell = grid.get(key)
        if (cell) cell.push(p)
        else grid.set(key, [p])
      }
      /** Total overlap between the cards in `moved` and every card outside it. */
      const clash = (moved: Set<Piece>) => {
        let sum = 0
        for (const a of moved) {
          if (!a.card) continue
          const ha = half(a)
          const [gx, gy] = [Math.floor(a.x / CELL), Math.floor(a.y / CELL)]
          for (let i = -1; i <= 1; i++)
            for (let j = -1; j <= 1; j++)
              for (const b of grid.get(`${gx + i},${gy + j}`) ?? []) {
                if (moved.has(b)) continue
                const hb = half(b)
                const ox = ha.hw + hb.hw + 2 - Math.abs(a.x - b.x)
                const oy = ha.hh + hb.hh + 2 - Math.abs(a.y - b.y)
                if (ox > 0 && oy > 0) sum += Math.min(ox, oy)
              }
        }
        return sum
      }
      let moves = 0
      for (const a of cards) {
        if (!a.parent || !clash(new Set([a]))) continue
        // Try swinging the card (then the boughs below it) round its parent, or sliding it along its limb.
        let best: { family: Piece[]; move: (sign: 1 | -1) => void; gain: number } | null = null
        for (let pivot = a, up = 0; up < 6 && pivot.parent; pivot = pivot.parent, up++) {
          const family = familyOf(pivot)
          if (family.length > UNTANGLE_FAMILY) break
          const moved = new Set(family)
          const before = clash(moved)
          const [ox, oy] = [pivot.parent!.x, pivot.parent!.y]
          const d = Math.hypot(pivot.x - ox, pivot.y - oy) || 1
          const [ux, uy] = [(pivot.x - ox) / d, (pivot.y - oy) / d]
          const tries: Array<(sign: 1 | -1) => void> = [
            ...[0.02, -0.02, 0.05, -0.05, 0.1, -0.1, 0.2, -0.2, 0.35, -0.35].map((angle) => (sign: 1 | -1) => swing(family, ox, oy, sign * angle)),
            ...[1 - STRETCH, 0.9, 1.1, 1 + STRETCH].map((f) => (sign: 1 | -1) => {
              const by = sign * (f * limb - d)
              for (const q of family) (q.x += ux * by), (q.y += uy * by)
            }),
          ]
          for (const move of tries) {
            move(1)
            const climbs = oy - pivot.y >= 0.25 * Math.abs(pivot.x - ox)
            const gain = climbs ? before - clash(moved) : 0
            move(-1)
            if (gain > 0.5 && (!best || gain > best.gain)) best = { family, move, gain }
          }
          if (best) break
        }
        if (best) {
          best.move(1)
          moves++
        }
      }
      if (!moves) break
    }
  }

  // Trim, let the cards that now touch shove apart again, and trim once more.
  for (let i = 0; i < TRIMS; i++) {
    trim()
    sim.alpha(0.3).tick(SIM_TICKS / 3)
  }
  trim()
  untangle()

  const x = new Map<string, number>()
  const y = new Map<string, number>()
  for (const p of pieces) if (p.card) x.set(p.card.data.id, p.x), y.set(p.card.data.id, p.y)
  for (const n of all) if (n.data.unknown) x.set(n.data.id, x.get(limbFrom(n).data.id)!), y.set(n.data.id, y.get(limbFrom(n).data.id)!)
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
    // Along the wood from the parent: up the stem, then out along the twig. Each piece is straight,
    // with a slight bow to one side or the other: diagonal, never winding.
    const path = lineage(pieceOf.get(n)!)
    const stop = path.indexOf(pieceOf.get(from)!)
    const joints = path.slice(0, stop + 1).reverse()
    const centre: Point[] = [[pp.x, pp.y]]
    for (let j = 1; j < joints.length; j++) {
      const [s0, s1] = [joints[j - 1], joints[j]]
      const [dx, dy] = [s1.x - s0.x, s1.y - s0.y]
      const bow = wobble(s1.key, 4) * BOW
      for (let i = 1; i <= BRANCH_SAMPLES / 2; i++) {
        const t = i / (BRANCH_SAMPLES / 2)
        const off = bow * 4 * t * (1 - t)
        centre.push([s0.x + dx * t - dy * off, s0.y + dy * t + dx * off])
      }
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
