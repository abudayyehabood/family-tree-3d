import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, Ref } from 'react'
import { select } from 'd3-selection'
import { zoom, zoomIdentity } from 'd3-zoom'
import type { D3ZoomEvent, ZoomBehavior, ZoomTransform } from 'd3-zoom'
import { Crosshair, Minus, Plus } from 'lucide-react'
import { cardHalf, hitTest } from '../lib/treeLayout'
import type { Box, LayoutLink, LayoutNode, TreeLayout } from '../lib/treeLayout'
import Branch, { Bark, MIN_SCREEN_WIDTH, WOOD } from './Branch'
import Foliage from './Foliage'
import NodeCard from './NodeCard'
import Trunk, { TRUNK_DEPTH } from './Trunk'

/** Low enough to fit a fully expanded 700-person tree on a phone. */
const MIN_SCALE = 0.005
const MAX_SCALE = 3
const ZOOM_STEP = 1.35
/** Only elements within the viewport plus this many screen-widths of margin are mounted. */
const CULL_MARGIN = 1
const CULL_INTERVAL_MS = 120
/** Half-extent of the largest card (plus its foliage), for node culling. */
const NODE_REACH = 120
/** Below this zoom the bark veins are under a pixel wide and are not drawn. */
const FAR_ZOOM = 0.05
/** Below this zoom cards are drawn as dots of DOT_PX screen radius (cards are then a few pixels wide). */
const DOT_ZOOM = 0.1
const DOT_PX = 3.5
/** A press that travels further than this (CSS px) was a pan, not a tap. */
const TAP_SLOP = 10
/** Screen-px of forgiveness around a card, so cards stay tappable at a zoomed-out fit. */
const TAP_PAD = 12

/** Generation labels whose rows are closer than this on screen (px) and overlap sideways hide the later one. */
const LABEL_GAP = 22
/** Screen room (px) the whole-tree fit keeps left of the tree for generation labels. */
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
}

const NodesLayer = memo(function NodesLayer({ nodes, selectedId }: NodesLayerProps) {
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
  const [zoomPercent, setZoomPercent] = useState(100)
  const [inlineEdit, setInlineEdit] = useState<InlineEdit | null>(null)
  const [viewBox, setViewBox] = useState<Box | null>(null)
  const lastCullRef = useRef(0)
  const actionsRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef(selectedId)
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
  /** Pins each generation label to the end of its ring, hiding any that would crowd the one before. */
  const placeLabels = useCallback((t: ZoomTransform) => {
    const el = labelsRef.current
    if (!el) return
    const shown: Array<[number, number, number]> = []
    for (const span of Array.from(el.children) as HTMLElement[]) {
      const ring = layoutRef.current.rings[Number(span.dataset.index)]
      if (!ring) continue
      // Anchored on the label's right edge; the width is only known once it is on the page.
      const x = t.x + ring.x * t.k
      const w = span.offsetWidth || 60
      const free = (y: number) => shown.every(([sx, sy, sw]) => Math.abs(sy - y) >= LABEL_GAP || x <= sx - sw || x - w >= sx)
      // A crowded label steps up or down beside its generation (up first: that is where it grows) before it gives up and hides.
      const at = t.y + ring.y * t.k
      const y = [0, -0.5, 0.5, -1, 1, -1.5, -2].map((step) => at + step * LABEL_GAP).find(free)
      const show = y !== undefined
      span.style.visibility = show ? '' : 'hidden'
      span.style.transform = `translate(${x}px, ${y ?? at}px) translate(-100%, -50%)`
      if (show) shown.push([x, y, w])
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

  useLayoutEffect(() => {
    layoutRef.current = layout
    selectedRef.current = selectedId
    placeActions(transformRef.current)
    placeLabels(transformRef.current)
  }, [layout, selectedId, actions, placeActions, placeLabels])

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
        viewport.style.setProperty('--dot-r', `${Math.min(80, DOT_PX / event.transform.k)}px`)
        placeActions(event.transform)
        placeLabels(event.transform)
        setZoomPercent(Math.round(event.transform.k * 100))
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
  }, [cancelAnimation, updateViewBox, placeActions, placeLabels])

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
      // The generation labels hang off the left of the tree: keep screen room for them.
      const labels = layoutRef.current.rings.length ? LABEL_ROOM : 0
      const k = Math.min((svg.clientWidth - padding * 2 - labels) / (right - left), (svg.clientHeight - padding * 2) / (bottom - top), 1.2)
      moveCamera((left + right) / 2 - labels / 2 / k, (top + bottom) / 2, k, animate)
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

  const zoomBy = (factor: number) => {
    const svg = svgRef.current
    if (!svg) return
    const t = transformRef.current
    const cx = (svg.clientWidth / 2 - t.x) / t.k
    const cy = (svg.clientHeight / 2 - t.y) / t.k
    moveCamera(cx, cy, t.k * factor, true, 280)
  }

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
      const hit = hitTest(layoutRef.current.nodes, wx, wy, TAP_PAD / t.k)
      if (!hit) onSelect(null)
      else if (hit.badge) onToggle(hit.node.id)
      else onSelect(hit.node.id)
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
          <NodesLayer nodes={visibleNodes} selectedId={selectedId} />
        </g>
      </svg>

      <div ref={labelsRef} className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden>
        {layout.rings.map((ring, i) => (
          <span
            key={ring.generation}
            data-index={i}
            className="absolute top-0 left-0 whitespace-nowrap rounded-full bg-[#3b2412]/75 px-2 py-0.5 text-[11px] font-bold text-amber-50 shadow sm:text-xs"
          >
            الجيل {ring.generation}
          </span>
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
        <span className="w-7 text-center text-[10px] font-bold text-amber-50 tabular-nums sm:w-14 sm:text-sm" dir="ltr">
          {zoomPercent}%
        </span>
        <button
          type="button"
          aria-label="تصغير"
          title="تصغير"
          onClick={() => zoomBy(1 / ZOOM_STEP)}
          className="grid size-6 place-items-center rounded-full bg-white/10 text-amber-50 transition hover:bg-white/25 sm:size-11"
        >
          <Minus className="size-3 sm:size-6" strokeWidth={3} />
        </button>
      </div>
    </div>
  )
}
