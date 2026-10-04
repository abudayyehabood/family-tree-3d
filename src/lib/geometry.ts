export type Point = [number, number]

const r1 = (v: number) => Math.round(v * 10) / 10
const fmt = ([x, y]: Point) => `${r1(x)},${r1(y)}`

/** Catmull-Rom spline through the points, emitted as cubic Bézier segments (assumes the pen is at points[0]). */
function smoothThrough(points: Point[]): string {
  let d = ''
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
    const c1: Point = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2: Point = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += `C${fmt(c1)} ${fmt(c2)} ${fmt(p2)}`
  }
  return d
}

/**
 * Filled, tapered shape following the cubic Bézier p0 → p3 (controls p1, p2).
 * Width goes from w0 at p0 to w1 at p3, flaring slightly near the start like real wood.
 */
export function taperedCubicPath(p0: Point, p1: Point, p2: Point, p3: Point, w0: number, w1: number, samples = 10): string {
  const left: Point[] = []
  const right: Point[] = []
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const mt = 1 - t
    const a = mt * mt * mt
    const b = 3 * mt * mt * t
    const c = 3 * mt * t * t
    const e = t * t * t
    const x = a * p0[0] + b * p1[0] + c * p2[0] + e * p3[0]
    const y = a * p0[1] + b * p1[1] + c * p2[1] + e * p3[1]
    const dx = 3 * mt * mt * (p1[0] - p0[0]) + 6 * mt * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0])
    const dy = 3 * mt * mt * (p1[1] - p0[1]) + 6 * mt * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1])
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len
    const ny = dx / len
    const hw = (w1 + (w0 - w1) * Math.pow(mt, 1.4)) / 2
    left.push([x + nx * hw, y + ny * hw])
    right.push([x - nx * hw, y - ny * hw])
  }
  right.reverse()
  return `M${fmt(left[0])}${smoothThrough(left)}L${fmt(right[0])}${smoothThrough(right)}Z`
}

/**
 * Filled, tapered shape following an arbitrary centre-line, width w0 at the first point tapering to
 * w1 at the last. Same flare as `taperedCubicPath`; used where the centre-line is a curved limb and
 * therefore cannot be expressed as a single cubic.
 */
export function taperedPolylinePath(centre: Point[], w0: number, w1: number): string {
  const left: Point[] = []
  const right: Point[] = []
  const last = centre.length - 1
  for (let i = 0; i <= last; i++) {
    const [x, y] = centre[i]
    const prev = centre[Math.max(0, i - 1)]
    const next = centre[Math.min(last, i + 1)]
    const dx = next[0] - prev[0]
    const dy = next[1] - prev[1]
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len
    const ny = dx / len
    const mt = 1 - i / last
    const hw = (w1 + (w0 - w1) * Math.pow(mt, 1.4)) / 2
    left.push([x + nx * hw, y + ny * hw])
    right.push([x - nx * hw, y - ny * hw])
  }
  right.reverse()
  return `M${fmt(left[0])}${smoothThrough(left)}L${fmt(right[0])}${smoothThrough(right)}Z`
}

/** Tapered branch with vertical tangents at both ends (used for the roots). */
export function taperedBranchPath(sx: number, sy: number, tx: number, ty: number, w0: number, w1: number, samples = 10): string {
  const my = sy + (ty - sy) * 0.5
  return taperedCubicPath([sx, sy], [sx, my], [tx, my], [tx, ty], w0, w1, samples)
}

/** Cheap deterministic 0–1 random from a string, so a branch keeps the same grain on every render. */
function hashRandom(key: string): () => number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
}

/**
 * Bark on a branch, as filled shapes that taper with the wood: a shaded underside and a lit ridge give
 * it roundness, and a few long wavy veins run along it. `lane` is where a vein sits across the branch
 * (-1 one edge … 1 the other), `width` its thickness as a fraction of the branch's.
 */
export function branchBark(centre: Point[], w0: number, w1: number, key: string): { shade: string; light: string; veins: string } {
  const rand = hashRandom(key)
  const last = centre.length - 1
  const normals = centre.map((_, i) => {
    const [px, py] = centre[Math.max(0, i - 1)]
    const [nx, ny] = centre[Math.min(last, i + 1)]
    const len = Math.hypot(nx - px, ny - py) || 1
    return [-(ny - py) / len, (nx - px) / len] as Point
  })
  const halfWidth = (i: number) => (w1 + (w0 - w1) * Math.pow(1 - i / last, 1.4)) / 2
  /** Strip across the branch at `lane`, `width` thick (fractions of the branch), shaped by `profile` along it. */
  const band = (lane: (i: number) => number, width: number, from = 0, to = last, profile = (_s: number) => 1) => {
    const left: Point[] = []
    const right: Point[] = []
    for (let i = from; i <= to; i++) {
      const hw = halfWidth(i)
      const half = (width * profile((i - from) / (to - from))) / 2
      const [x, y] = centre[i]
      const [nx, ny] = normals[i]
      left.push([x + nx * (lane(i) + half) * hw, y + ny * (lane(i) + half) * hw])
      right.push([x + nx * (lane(i) - half) * hw, y + ny * (lane(i) - half) * hw])
    }
    right.reverse()
    return `M${fmt(left[0])}${smoothThrough(left)}L${fmt(right[0])}${smoothThrough(right)}Z`
  }
  /** Veins swell in the middle and run out to a point at both ends. */
  const spindle = (s: number) => Math.pow(Math.sin(Math.PI * s), 0.7)
  const veins: string[] = []
  const count = 3 + Math.floor(rand() * 2)
  for (let v = 0; v < count; v++) {
    const base = -0.6 + (1.2 * (v + 0.2 + rand() * 0.6)) / count
    const phase = rand() * Math.PI * 2
    const wobble = 0.06 + rand() * 0.08
    const from = Math.floor(rand() * last * 0.3)
    const to = last - Math.floor(rand() * last * 0.35)
    veins.push(band((i) => base + wobble * Math.sin(phase + i * 0.45), 0.12, from, to, spindle))
  }
  return {
    shade: band(() => -0.62, 0.36),
    light: band(() => 0.4, 0.22),
    veins: veins.join(''),
  }
}
