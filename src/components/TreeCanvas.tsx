import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, Ref } from 'react'
import { select } from 'd3-selection'
import { zoom, zoomIdentity } from 'd3-zoom'
import type { D3ZoomEvent, ZoomBehavior, ZoomTransform } from 'd3-zoom'
import { Crosshair, Minus, Plus } from 'lucide-react'
import { badgeScale, cardHalf, genColour, hitTest, NAME_TAG_PX } from '../lib/treeLayout'
import type { Box, LayoutLink, LayoutNode, TreeLayout } from '../lib/treeLayout'
import Branch, { Bark, MIN_SCREEN_WIDTH, WOOD } from './Branch'
import Foliage from './Foliage'
import NodeCard from './NodeCard'
import Trunk, { TRUNK_DEPTH } from './Trunk'

/** Low enough to fit a fully expanded 700-person tree on a phone. */
const MIN_SCALE = 0.005
const MAX_SCALE = 3
const ZOOM_STEP = 1.35
const SLIDER_STEPS = 1000
const LOG_SPAN = Math.log(MAX_SCALE / MIN_SCALE)
const scaleToSlider = (k: number) => (Math.log(k / MIN_SCALE) / LOG_SPAN) * SLIDER_STEPS
const sliderToScale = (v: number) => MIN_SCALE * Math.exp((v / SLIDER_STEPS) * LOG_SPAN)
/** Only elements within the viewport plus this many screen-widths of margin are mounted. */
const CULL_MARGIN = 1
const CULL_INTERVAL_MS = 120
/** Half-extent of the largest card (plus its foliage), for node culling. */
const NODE_REACH = 120
/** Below this zoom the bark veins are under a pixel wide and are not drawn. */
const FAR_ZOOM = 0.05
/** Below this zoom cards are drawn as dots of DOT_PX screen radius (names are then under 4px, unreadable). */
const DOT_ZOOM = 0.22
const DOT_PX = 4
/** …but never wider than this (world units): crowded rows sit about 110 apart, so dots there stay apart. */
const DOT_MAX = 45
/** Far out, names are picked again once the zoom has changed by this factor (log). */
const NAME_REPICK = 0.04
/** Clear space (px) kept between two name tags. */
const TAG_GAP = 6
/** Screen box (px, from the dot's centre) a name tag takes: it sits just above the dot. */
const TAG_TOP = -NAME_TAG_PX - 9 - TAG_GAP / 2
const TAG_BOTTOM = -2 + TAG_GAP / 2
const TAG_CELL = 64
const tagWidths = new Map<string, number>()
let tagRuler: CanvasRenderingContext2D | null | undefined
/** Half a name tag's width on screen (px), measured in the page's own font, plus its halo and gap. */
function tagHalfWidth(name: string): number {
  let w = tagWidths.get(name)
  if (w === undefined) {
    if (tagRuler === undefined) {
      tagRuler = document.createElement('canvas').getContext('2d')
      if (tagRuler) tagRuler.font = `800 ${NAME_TAG_PX}px ${getComputedStyle(document.body).fontFamily}`
    }
    const text = name.length > 14 ? `${name.slice(0, 13)}…` : name
    w = (tagRuler ? tagRuler.measureText(text).width : text.length * NAME_TAG_PX * 0.8) + 4 + TAG_GAP
    tagWidths.set(name, w)
  }
  return w / 2
}

/**
 * Which dots get their name far out: as many as fit without one tag covering another. The elders go
 * first: they are the fewest and hold the tree together.
 */
function pickNamed(nodes: LayoutNode[], k: number): Set<string> {
  const named = new Set<string>()
  const grid = new Map<string, Array<[number, number, number, number]>>()
  const cells = (x0: number, x1: number, y0: number, y1: number) => {
    const out: string[] = []
    for (let i = Math.floor(x0 / TAG_CELL); i <= Math.floor(x1 / TAG_CELL); i++)
      for (let j = Math.floor(y0 / TAG_CELL); j <= Math.floor(y1 / TAG_CELL); j++) out.push(`${i},${j}`)
    return out
  }
  for (const n of [...nodes].sort((a, b) => a.generation - b.generation)) {
    const hw = tagHalfWidth(n.name)
    const box: [number, number, number, number] = [n.x * k - hw, n.y * k + TAG_TOP, n.x * k + hw, n.y * k + TAG_BOTTOM]
    const keys = cells(box[0], box[2], box[1], box[3])
    const clash = keys.some((key) => grid.get(key)?.some((o) => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1]))
    if (clash) continue
    named.add(n.id)
    for (const key of keys) grid.set(key, [...(grid.get(key) ?? []), box])
  }
  return named
}

/** A press that travels further than this (CSS px) was a pan, not a tap. */
const TAP_SLOP = 10
/** Screen-px of forgiveness around a card, so cards stay tappable at a zoomed-out fit. */
const TAP_PAD = 12

/** Generation labels whose rows are closer than this on screen (px) and overlap sideways hide the later one. */
const LABEL_GAP = 22
/** Screens narrower than this (px) label generations on the left only. */
const TWO_LABELS = 640
/** Labels stay at least this far (px) inside the screen's edges. */
const LABEL_EDGE = 6
/** Screen room (px) the whole-tree fit keeps each side of the tree for generation labels. */
const LABEL_ROOM = 80
/** Half the width of the trunk's spread roots, which a fit always keeps on screen. */
const ROOTS_HALF_WIDTH = 220
/** Gold of the selected person's line back to the trunk. */
const LINEAGE = '#f59e0b'

/** Extra trunk length (unscaled units) when the crown hangs below the founder, so the ground stays under every card. */
const trunkExtra = (l: TreeLayout) => Math.max(0, (l.bounds.maxY + 150) / l.trunkScale - 220)

const intersects = (a: Box, b: Box) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY

export interface TreeCanvasHandle {
  centerTree: (animate?: boolean) => void
  focusNode: (id: string, animate?: boolean) => void
  /** Opens the inline name editor on top of the card. */
  editName: (id: string) => void
}

interface TreeCanvasProps {
  layout: TreeLayout
  selectedId: string | null
  onSelect: (id: string | null) => void
  onToggle: (id: string) => void
  onRename: (id: string, name: string) => void
  /** Quick-action bar shown right under the selected card. */
  actions?: ReactNode
  ref?: Ref<TreeCanvasHandle>
}

interface InlineEdit {
  id: string
  value: string
  left: number
  top: number
}

const BranchesLayer = memo(function BranchesLayer({ links }: { links: LayoutLink[] }) {
  return (
    <g className="branches-layer">
      {links.map((l) => (
        <Branch key={l.id} d={l.d} />
      ))}
      {/* Knots over every fork, drawn after the branches so they hide the seams where limbs meet. */}
      {links.map(({ id, knot: [x, y, r] }) => (
        <circle key={id} cx={x} cy={y} r={r} fill={WOOD} />
      ))}
      {/* Too fine to see when far out (see FAR_ZOOM), so it is switched off there. */}
      <g className="bark-layer">
        {links.map(({ id, bark }) => (
          <Bark key={id} {...bark} />
        ))}
      </g>
    </g>
  )
})

/** The selected person's branches all the way down to the trunk, drawn in gold over the wood. */
const LineageLayer = memo(function LineageLayer({ links, selectedId }: { links: LayoutLink[]; selectedId: string | null }) {
  const path = useMemo(() => {
    const byChild = new Map(links.map((l) => [l.id, l]))
    const out: LayoutLink[] = []
    for (let l = selectedId ? byChild.get(selectedId) : undefined; l; l = byChild.get(l.from)) out.push(l)
    return out
  }, [links, selectedId])
  if (!path.length) return null
  return (
    <g className="lineage-layer" pointerEvents="none">
      {path.map((l) => (
        <path key={l.id} d={l.d} fill={LINEAGE} stroke={LINEAGE} strokeWidth={MIN_SCREEN_WIDTH * 2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      ))}
      {path.map(({ id, knot: [x, y, r] }) => (
        <circle key={id} cx={x} cy={y} r={r} fill={LINEAGE} />
      ))}
    </g>
  )
})

interface NodesLayerProps {
  nodes: LayoutNode[]
  selectedId: string | null
  named: Set<string>
}

const NodesLayer = memo(function NodesLayer({ nodes, selectedId, named }: NodesLayerProps) {
  return (
    <g className="nodes-layer">
      {nodes.map((n) => (
        <NodeCard
          key={n.id}
          id={n.id}
          type={n.type}
          gender={n.gender}
          name={n.name}
          generation={n.generation}
          born={n.born}
          died={n.died}
          husband={n.husband}
          x={n.x}
          y={n.y}
          isRoot={n.isRoot}
          collapsed={n.collapsed}
          childCount={n.childCount}
          hiddenCount={n.hiddenCount}
          selected={n.id === selectedId}
          named={named.has(n.id)}
        />
      ))}
    </g>
  )
})

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

const clampScale = (k: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, k))

export default function TreeCanvas({ layout, selectedId, onSelect, onToggle, onRename, actions, ref }: TreeCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const viewportRef = useRef<SVGGElement>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const transformRef = useRef<ZoomTransform>(zoomIdentity)
  const animationRef = useRef(0)
  const layoutRef = useRef(layout)
  const [zoomK, setZoomK] = useState(1)
  const [inlineEdit, setInlineEdit] = useState<InlineEdit | null>(null)
  const [viewBox, setViewBox] = useState<Box | null>(null)
  const lastCullRef = useRef(0)
  const actionsRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef(selectedId)
  /** Dots whose name shows far out, and the zoom they were picked at. */
  const [named, setNamed] = useState<Set<string>>(() => new Set())
  /** A generation picked on the colour key: every other card fades, so it is plain which cards it is. */
  const [focusGen, setFocusGen] = useState<number | null>(null)
  const namedKRef = useRef(0)
  /** A card whose fold was just tapped, and where it sat on screen: the camera keeps it there. */
  const anchorRef = useRef<{ id: string; sx: number; sy: number } | null>(null)
  /** True while the camera is still the automatic whole-tree fit; cleared once the user pans or zooms. */
  const autoFitRef = useRef(true)

  /** Pins the quick-action bar under the selected card (runs on every pan/zoom frame, no re-render). */
  const placeActions = useCallback((t: ZoomTransform) => {
    const el = actionsRef.current
    if (!el) return
    const node = selectedRef.current ? layoutRef.current.byId.get(selectedRef.current) : undefined
    if (!node) {
      el.style.display = 'none'
      return
    }
    const halfH = cardHalf(node.type, !!node.husband).hh + (node.isRoot ? 12 : 0)
    el.style.display = ''
    el.style.left = `${t.x + node.x * t.k}px`
    el.style.top = `${t.y + (node.y + halfH) * t.k + 10}px`
  }, [])

  const labelsRef = useRef<HTMLDivElement>(null)
  /**
   * Pins each generation's two labels level with its row, one each side of the crown, kept on screen when
   * the crown runs off it; a label that would crowd the one before steps aside or hides.
   */
  const placeLabels = useCallback((t: ZoomTransform) => {
    const el = labelsRef.current
    if (!el) return
    const shown: Array<[number, number, number]> = []
    for (const span of Array.from(el.children) as HTMLElement[]) {
      const ring = layoutRef.current.rings[Number(span.dataset.index)]
      if (!ring) continue
      // A phone has no width to spare for a second column.
      if (span.dataset.side === 'right' && el.clientWidth < TWO_LABELS) {
        span.style.visibility = 'hidden'
        continue
      }
      // The width is only known once it is on the page.
      const w = span.offsetWidth || 60
      const left =
        span.dataset.side === 'right'
          ? Math.min(t.x + ring.xr * t.k, el.clientWidth - w - LABEL_EDGE)
          : Math.max(t.x + ring.x * t.k, w + LABEL_EDGE) - w
      const free = (y: number) => shown.every(([sx, sy, sr]) => Math.abs(sy - y) >= LABEL_GAP || left + w <= sx || left >= sr)
      // A crowded label steps up or down beside its generation (up first: that is where it grows) before it gives up and hides.
      const at = t.y + ring.y * t.k
      const y = [0, -0.5, 0.5, -1, 1, -1.5, -2].map((step) => at + step * LABEL_GAP).find(free)
      const show = y !== undefined
      span.style.visibility = show ? '' : 'hidden'
      span.style.transform = `translate(${left}px, ${y ?? at}px) translate(0, -50%)`
      if (show) shown.push([left, y, left + w])
    }
  }, [])

  /** World-space rectangle currently worth rendering (viewport + margin). */
  const updateViewBox = useCallback((t: ZoomTransform) => {
    const svg = svgRef.current
    if (!svg) return
    const w = svg.clientWidth
    const h = svg.clientHeight
    const mx = w * CULL_MARGIN
    const my = h * CULL_MARGIN
    lastCullRef.current = performance.now()
    setViewBox({ minX: (-mx - t.x) / t.k, minY: (-my - t.y) / t.k, maxX: (w + mx - t.x) / t.k, maxY: (h + my - t.y) / t.k })
  }, [])

  const visibleNodes = useMemo(() => {
    if (!viewBox) return layout.nodes
    return layout.nodes.filter((n) =>
      intersects(viewBox, { minX: n.x - NODE_REACH, minY: n.y - NODE_REACH, maxX: n.x + NODE_REACH, maxY: n.y + NODE_REACH }),
    )
  }, [layout.nodes, viewBox])

  const visibleLinks = useMemo(
    () => (viewBox ? layout.links.filter((l) => intersects(viewBox, l.box)) : layout.links),
    [layout.links, viewBox],
  )

  const refreshNames = useCallback((k: number, force = false) => {
    if (k >= DOT_ZOOM) return
    if (!force && Math.abs(Math.log(k / namedKRef.current)) < NAME_REPICK) return
    namedKRef.current = k
    setNamed(pickNamed(layoutRef.current.nodes, k))
  }, [])

  // Folding or opening a branch re-grows the whole crown, so every card moves. Keep the one that was
  // tapped where it was on screen, or the person loses their place.
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    anchorRef.current = null
    const node = anchor && layout.byId.get(anchor.id)
    const svg = svgRef.current
    const behavior = zoomRef.current
    if (!anchor || !node || !svg || !behavior) return
    const { k } = transformRef.current
    behavior.transform(select(svg), zoomIdentity.translate(anchor.sx - node.x * k, anchor.sy - node.y * k).scale(k))
  }, [layout])

  useLayoutEffect(() => {
    layoutRef.current = layout
    refreshNames(transformRef.current.k, true)
    selectedRef.current = selectedId
    placeActions(transformRef.current)
    placeLabels(transformRef.current)
  }, [layout, selectedId, actions, placeActions, placeLabels, refreshNames])

  const cancelAnimation = useCallback(() => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current)
    animationRef.current = 0
  }, [])

  useEffect(() => {
    const svg = svgRef.current
    const viewport = viewportRef.current
    if (!svg || !viewport) return
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([MIN_SCALE, MAX_SCALE])
      .on('start', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        if (event.sourceEvent) {
          autoFitRef.current = false
          cancelAnimation()
          setInlineEdit(null)
        }
      })
      .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        // Pan/zoom only rewrites the viewport transform; the memoised layers never re-render.
        transformRef.current = event.transform
        viewport.setAttribute('transform', event.transform.toString())
        viewport.classList.toggle('far', event.transform.k < FAR_ZOOM)
        viewport.classList.toggle('tiny', event.transform.k < DOT_ZOOM)
        // Fixed size on screen, but never so big that neighbours' dots merge into one blot.
        viewport.style.setProperty('--dot-r', `${Math.min(DOT_MAX, DOT_PX / event.transform.k)}px`)
        viewport.style.setProperty('--inv-k', String(1 / event.transform.k))
        viewport.style.setProperty('--badge-s', String(badgeScale(event.transform.k)))
        refreshNames(event.transform.k)
        placeActions(event.transform)
        placeLabels(event.transform)
        setZoomK(event.transform.k)
        if (performance.now() - lastCullRef.current > CULL_INTERVAL_MS) updateViewBox(event.transform)
      })
      .on('end', (event: D3ZoomEvent<SVGSVGElement, unknown>) => updateViewBox(event.transform))
    const selection = select(svg)
    selection.call(behavior).on('dblclick.zoom', null)
    zoomRef.current = behavior
    return () => {
      cancelAnimation()
      selection.on('.zoom', null)
      zoomRef.current = null
    }
  }, [cancelAnimation, updateViewBox, placeActions, placeLabels, refreshNames])

  /** Moves the camera so world point (cx, cy) sits at the viewport centre with scale k. */
  const moveCamera = useCallback(
    (cx: number, cy: number, k: number, animate: boolean, duration = 800) => {
      const svg = svgRef.current
      const behavior = zoomRef.current
      if (!svg || !behavior) return
      const width = svg.clientWidth
      const height = svg.clientHeight
      const selection = select(svg)
      const apply = (x: number, y: number, scale: number) =>
        behavior.transform(selection, zoomIdentity.translate(width / 2 - x * scale, height / 2 - y * scale).scale(scale))

      cancelAnimation()
      setInlineEdit(null)
      const target = clampScale(k)
      if (!animate) {
        apply(cx, cy, target)
        return
      }
      const from = transformRef.current
      const fromX = (width / 2 - from.x) / from.k
      const fromY = (height / 2 - from.y) / from.k
      const start = performance.now()
      const step = (now: number) => {
        const p = Math.min(1, (now - start) / duration)
        const e = easeInOutCubic(p)
        const scale = from.k * Math.pow(target / from.k, e)
        apply(fromX + (cx - fromX) * e, fromY + (cy - fromY) * e, scale)
        animationRef.current = p < 1 ? requestAnimationFrame(step) : 0
      }
      animationRef.current = requestAnimationFrame(step)
    },
    [cancelAnimation],
  )

  const centerTree = useCallback(
    (animate = true) => {
      const svg = svgRef.current
      if (!svg) return
      autoFitRef.current = true
      const { bounds, trunkScale } = layoutRef.current
      // Frame the crown and the trunk's roots; the grassy hill may run off the sides.
      const left = Math.min(bounds.minX, -ROOTS_HALF_WIDTH * trunkScale)
      const right = Math.max(bounds.maxX, ROOTS_HALF_WIDTH * trunkScale)
      const top = bounds.minY
      const bottom = (TRUNK_DEPTH + trunkExtra(layoutRef.current)) * trunkScale
      // A phone has no width to spare for a wide margin.
      const padding = Math.min(50, svg.clientWidth * 0.04)
      // The generation labels hang off the sides of the tree (only the left on a phone): keep screen room for them.
      const labels = layoutRef.current.rings.length ? LABEL_ROOM : 0
      const sides = svg.clientWidth < TWO_LABELS ? 1 : 2
      const k = Math.min((svg.clientWidth - padding * 2 - labels * sides) / (right - left), (svg.clientHeight - padding * 2) / (bottom - top), 1.2)
      moveCamera((left + right) / 2 - (sides === 1 ? labels / 2 / k : 0), (top + bottom) / 2, k, animate)
    },
    [moveCamera],
  )

  /**
   * A viewport change - rotating a phone, the iOS keyboard, a resized window - used to leave the
   * camera exactly where it was, which on a rotation put the whole tree off-screen. While the
   * camera is still the automatic fit, re-fit it; once the user has framed something themselves,
   * keep their scale and whatever they had centred.
   */
  useEffect(() => {
    let timer = 0
    let prev = { w: svgRef.current?.clientWidth ?? 0, h: svgRef.current?.clientHeight ?? 0 }
    const onResize = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = 0
        const svg = svgRef.current
        if (!svg) return
        // The soft keyboard fires resize too: never move the ground under someone who is typing.
        const active = document.activeElement
        if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
          updateViewBox(transformRef.current)
        } else if (autoFitRef.current) {
          centerTree(false)
        } else {
          const t = transformRef.current
          moveCamera((prev.w / 2 - t.x) / t.k, (prev.h / 2 - t.y) / t.k, t.k, false)
        }
        prev = { w: svg.clientWidth, h: svg.clientHeight }
      }, 150)
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('resize', onResize)
    }
  }, [centerTree, moveCamera, updateViewBox])

  /** Zooms to scale k round the viewport centre: animated for the buttons, instant while the slider drags. */
  const zoomTo = (k: number, animate: boolean) => {
    const svg = svgRef.current
    if (!svg) return
    const t = transformRef.current
    const cx = (svg.clientWidth / 2 - t.x) / t.k
    const cy = (svg.clientHeight / 2 - t.y) / t.k
    moveCamera(cx, cy, k, animate, 280)
  }
  const zoomBy = (factor: number) => zoomTo(transformRef.current.k * factor, true)

  /**
   * Taps are handled here, from raw coordinates, for two reasons that both broke iPhone:
   * d3-zoom stops propagation of touchstart/touchend so WebKit never synthesizes a click for
   * the cards underneath, and mobile touch adjustment retargets a tap onto the nearest small
   * clickable element — at a whole-tree fit a card is ~36px wide and its collapse badge ~6px,
   * so badges were swallowing taps aimed at names.
   */
  const tapRef = useRef<{ x: number; y: number; pointerId: number } | null>(null)
  const tapHandledAtRef = useRef(0)

  const resolveTap = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current
      if (!svg) return
      const box = svg.getBoundingClientRect()
      const t = transformRef.current
      const wx = (clientX - box.left - t.x) / t.k
      const wy = (clientY - box.top - t.y) / t.k
      const hit = hitTest(layoutRef.current.nodes, wx, wy, TAP_PAD / t.k, t.k < DOT_ZOOM ? 0 : badgeScale(t.k))
      if (!hit) onSelect(null)
      else if (hit.badge) {
        anchorRef.current = { id: hit.node.id, sx: t.x + hit.node.x * t.k, sy: t.y + hit.node.y * t.k }
        autoFitRef.current = false
        onToggle(hit.node.id)
      } else onSelect(hit.node.id)
    },
    [onSelect, onToggle],
  )

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    // A second finger means a pinch; drop the pending tap.
    if (!event.isPrimary) return void (tapRef.current = null)
    tapRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId }
  }

  const handlePointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const start = tapRef.current
    tapRef.current = null
    // Marked handled either way, so the click fallback stays out of the way whenever
    // pointer events work — a pan that ends on a card must not select it.
    tapHandledAtRef.current = performance.now()
    if (!start || start.pointerId !== event.pointerId) return
    if (Math.abs(event.clientX - start.x) > TAP_SLOP || Math.abs(event.clientY - start.y) > TAP_SLOP) return
    // The browser may have nudged the pointer coordinates onto a nearby target; the press
    // position is where the finger actually landed.
    resolveTap(start.x, start.y)
  }

  /** Fallback for anything that delivers a click without usable pointer events. */
  const handleClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (performance.now() - tapHandledAtRef.current < 700) return
    resolveTap(event.clientX, event.clientY)
  }

  const handleEdit = useCallback(
    (id: string) => {
      const node = layoutRef.current.byId.get(id)
      if (!node) return
      const t = transformRef.current
      onSelect(id)
      setInlineEdit({ id, value: node.name, left: t.x + node.x * t.k, top: t.y + node.y * t.k })
    },
    [onSelect],
  )

  const handleDoubleClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const box = svg.getBoundingClientRect()
    const t = transformRef.current
    const hit = hitTest(layoutRef.current.nodes, (event.clientX - box.left - t.x) / t.k, (event.clientY - box.top - t.y) / t.k, 0)
    if (hit && !hit.badge) handleEdit(hit.node.id)
  }

  useImperativeHandle(
    ref,
    () => ({
      centerTree,
      focusNode(id, animate = true) {
        const node = layoutRef.current.byId.get(id)
        if (!node) return
        const k = Math.min(1.4, Math.max(transformRef.current.k, 1))
        moveCamera(node.x, node.y, k, animate)
      },
      editName: handleEdit,
    }),
    [centerTree, moveCamera, handleEdit],
  )

  const commitInlineEdit = () => {
    if (inlineEdit && inlineEdit.value.trim()) onRename(inlineEdit.id, inlineEdit.value.trim())
    setInlineEdit(null)
  }

  return (
    <div className="relative h-full w-full">
      <svg
        ref={svgRef}
        className="tree-canvas block h-full w-full touch-none"
        direction="rtl"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => (tapRef.current = null)}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <defs>
          <linearGradient id="woodTrunk" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#2a1609" />
            <stop offset="0.18" stopColor="#4f2f17" />
            <stop offset="0.42" stopColor="#7e5230" />
            <stop offset="0.58" stopColor="#6b4423" />
            <stop offset="0.85" stopColor="#452812" />
            <stop offset="1" stopColor="#24130a" />
          </linearGradient>
          <linearGradient id="woodRoot" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#5a371d" />
            <stop offset="1" stopColor="#3a210f" />
          </linearGradient>
          <linearGradient id="hill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#8cc063" />
            <stop offset="1" stopColor="#4f8a2f" />
          </linearGradient>
          <linearGradient id="cardMale" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#1f7a4d" />
            <stop offset="0.6" stopColor="#135c38" />
            <stop offset="1" stopColor="#3b2a14" />
          </linearGradient>
          <linearGradient id="cardFemale" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#d1fae5" />
            <stop offset="0.55" stopColor="#fbcfe8" />
            <stop offset="1" stopColor="#f9a8d4" />
          </linearGradient>
          <linearGradient id="cardFounder" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#8a5530" />
            <stop offset="1" stopColor="#3f220e" />
          </linearGradient>
          <linearGradient id="cardWife" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#fde68a" />
            <stop offset="1" stopColor="#f5a30b" />
          </linearGradient>
        </defs>
        <g ref={viewportRef}>
          <Foliage nodes={visibleNodes} crown={layout.crown} />
          <Trunk scale={layout.trunkScale} extra={trunkExtra(layout)} />
          <BranchesLayer links={visibleLinks} />
          <LineageLayer links={layout.links} selectedId={selectedId} />
          <NodesLayer nodes={visibleNodes} selectedId={selectedId} named={named} />
        </g>
      </svg>

      <div ref={labelsRef} className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden>
        {layout.rings.flatMap((ring, i) =>
          (['left', 'right'] as const).map((side) => (
            <span
              key={`${ring.generation}-${side}`}
              data-index={i}
              data-side={side}
              className="absolute top-0 left-0 whitespace-nowrap rounded-full bg-[#3b2412]/75 px-2 py-0.5 text-[11px] font-bold text-amber-50 shadow sm:text-xs"
            >
              الجيل {ring.generation}
            </span>
          )),
        )}
      </div>

      {/* Generations are no longer rows: a colour key says which colour is which. Tap one to light up just that generation. */}
      {focusGen !== null && <style>{`.tree-canvas .node-card:not([data-gen="${focusGen}"]) { opacity: 0.12; }`}</style>}
      <div className="absolute top-2 left-2 z-10 flex max-w-[60%] flex-wrap gap-1 rounded-lg bg-[#3b2412]/75 p-1.5 shadow">
        {[...new Set(layout.nodes.map((n) => n.generation))].sort((a, b) => a - b).map((g) => (
          <button
            key={g}
            type="button"
            aria-pressed={focusGen === g}
            onClick={() => setFocusGen(focusGen === g ? null : g)}
            className={`rounded-full px-2 py-0.5 text-[11px] font-bold text-white transition-opacity sm:text-xs ${focusGen === g ? 'ring-2 ring-white' : focusGen !== null ? 'opacity-40' : ''}`}
            style={{ background: genColour(g) }}
          >
            الجيل {g}
          </button>
        ))}
      </div>

      {actions && (
        <div
          ref={actionsRef}
          className="absolute z-20 hidden -translate-x-1/2 sm:block"
          style={{ display: 'none' }}
          onClick={(e) => e.stopPropagation()}
        >
          {actions}
        </div>
      )}

      {inlineEdit && (
        <input
          autoFocus
          value={inlineEdit.value}
          aria-label="تعديل الاسم"
          onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
          onFocus={(e) => e.target.select()}
          onBlur={commitInlineEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitInlineEdit()
            if (e.key === 'Escape') setInlineEdit(null)
          }}
          style={{ left: inlineEdit.left, top: inlineEdit.top }}
          className="absolute z-30 h-11 w-48 -translate-x-1/2 -translate-y-1/2 rounded-xl border-2 border-amber-500 bg-white px-3 text-center text-base font-bold text-stone-900 shadow-2xl outline-none"
        />
      )}

      {/* Camera bar: a thumbnail-sized strip on phones, a full control bar from `sm` up. */}
      <div className="absolute bottom-1 left-1 z-20 flex items-center gap-px rounded-full bg-[#3b2412]/95 p-px shadow-xl sm:bottom-4 sm:left-4 sm:gap-2 sm:p-1.5">
        <button
          type="button"
          onClick={() => centerTree(true)}
          aria-label="توسيط الشجرة"
          title="توسيط الشجرة"
          className="inline-flex size-6 items-center justify-center gap-2 rounded-full bg-amber-500 font-bold text-amber-950 transition hover:bg-amber-400 sm:h-11 sm:w-auto sm:px-4 sm:text-sm"
        >
          <Crosshair className="size-3 sm:size-4" />
          <span className="hidden sm:inline">توسيط الشجرة</span>
        </button>
        <button
          type="button"
          aria-label="تكبير"
          title="تكبير"
          onClick={() => zoomBy(ZOOM_STEP)}
          className="grid size-6 place-items-center rounded-full bg-white/10 text-amber-50 transition hover:bg-white/25 sm:size-11"
        >
          <Plus className="size-3 sm:size-6" strokeWidth={3} />
        </button>
        {/* Zoom bar on a log scale, so 1% to 300% each get room; left is far, right (by the + button) is near. */}
        <input
          type="range"
          dir="ltr"
          min={0}
          max={SLIDER_STEPS}
          value={Math.round(scaleToSlider(zoomK))}
          onChange={(e) => zoomTo(sliderToScale(Number(e.target.value)), false)}
          aria-label="شريط التكبير"
          title="شريط التكبير"
          style={{ "--fill": `${scaleToSlider(zoomK) / SLIDER_STEPS * 100}%` } as CSSProperties}
          className="zoom-bar h-6 w-20 shrink-0 px-1 sm:h-11 sm:w-44"
        />
        <button
          type="button"
          aria-label="تصغير"
          title="تصغير"
          onClick={() => zoomBy(1 / ZOOM_STEP)}
          className="grid size-6 place-items-center rounded-full bg-white/10 text-amber-50 transition hover:bg-white/25 sm:size-11"
        >
          <Minus className="size-3 sm:size-6" strokeWidth={3} />
        </button>
        <span className="w-7 text-center text-[10px] font-bold text-amber-50 tabular-nums sm:w-14 sm:text-sm" dir="ltr">
          {zoomK < 0.1 ? (zoomK * 100).toFixed(1) : Math.round(zoomK * 100)}%
        </span>
      </div>
    </div>
  )
}
