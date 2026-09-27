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
 * w1 at the last. Same flare as `taperedCubicPath`; used where the centre-line is a polar sweep and
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
