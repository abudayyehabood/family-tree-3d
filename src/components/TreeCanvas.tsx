import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, Ref } from 'react'
import { select } from 'd3-selection'
import { zoom, zoomIdentity } from 'd3-zoom'
import type { D3ZoomEvent, ZoomBehavior, ZoomTransform } from 'd3-zoom'
import { Crosshair, Minus, Plus } from 'lucide-react'
import { MEMBER_H, WIFE_H } from '../lib/treeLayout'
import type { Box, LayoutLink, LayoutNode, TreeLayout } from '../lib/treeLayout'
import Branch from './Branch'
import Foliage from './Foliage'
import NodeCard from './NodeCard'
import Trunk, { TRUNK_DEPTH, TRUNK_HALF_WIDTH } from './Trunk'

const MIN_SCALE = 0.02
const MAX_SCALE = 3
const ZOOM_STEP = 1.35
/** Only elements within the viewport plus this many screen-widths of margin are mounted. */
const CULL_MARGIN = 1
const CULL_INTERVAL_MS = 120
/** Half-extent of the largest card (plus its foliage), for node culling. */
const NODE_REACH = 120

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
        <Branch key={l.id} d={l.d} kind={l.kind} />
      ))}
    </g>
  )
})

interface NodesLayerProps {
  nodes: LayoutNode[]
  selectedId: string | null
  onSelect: (id: string) => void
  onToggle: (id: string) => void
  onEdit: (id: string) => void
}

const NodesLayer = memo(function NodesLayer({ nodes, selectedId, onSelect, onToggle, onEdit }: NodesLayerProps) {
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
          x={n.x}
          y={n.y}
          isRoot={n.isRoot}
          collapsed={n.collapsed}
          childCount={n.childCount}
          hiddenCount={n.hiddenCount}
          selected={n.id === selectedId}
          onSelect={onSelect}
          onToggle={onToggle}
          onEdit={onEdit}
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

  /** Pins the quick-action bar under the selected card (runs on every pan/zoom frame, no re-render). */
  const placeActions = useCallback((t: ZoomTransform) => {
    const el = actionsRef.current
    if (!el) return
    const node = selectedRef.current ? layoutRef.current.byId.get(selectedRef.current) : undefined
    if (!node) {
      el.style.display = 'none'
      return
    }
    const halfH = (node.type === 'wife' ? WIFE_H : MEMBER_H) / 2 + (node.isRoot ? 12 : 0)
    el.style.display = ''
    el.style.left = `${t.x + node.x * t.k}px`
    el.style.top = `${t.y + (node.y + halfH) * t.k + 10}px`
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
  }, [layout, selectedId, actions, placeActions])

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
          cancelAnimation()
          setInlineEdit(null)
        }
      })
      .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        // Pan/zoom only rewrites the viewport transform; the memoised layers never re-render.
        transformRef.current = event.transform
        viewport.setAttribute('transform', event.transform.toString())
        placeActions(event.transform)
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
  }, [cancelAnimation, updateViewBox, placeActions])

  useEffect(() => {
    const onResize = () => updateViewBox(transformRef.current)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [updateViewBox])

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
      const { bounds, trunkScale } = layoutRef.current
      const left = Math.min(bounds.minX, -TRUNK_HALF_WIDTH * trunkScale)
      const right = Math.max(bounds.maxX, TRUNK_HALF_WIDTH * trunkScale)
      const top = bounds.minY
      const bottom = TRUNK_DEPTH * trunkScale
      const padding = 50
      const k = Math.min((svg.clientWidth - padding * 2) / (right - left), (svg.clientHeight - padding * 2) / (bottom - top), 1.2)
      moveCamera((left + right) / 2, (top + bottom) / 2, k, animate)
    },
    [moveCamera],
  )

  const zoomBy = (factor: number) => {
    const svg = svgRef.current
    if (!svg) return
    const t = transformRef.current
    const cx = (svg.clientWidth / 2 - t.x) / t.k
    const cy = (svg.clientHeight / 2 - t.y) / t.k
    moveCamera(cx, cy, t.k * factor, true, 280)
  }

  const handleSelect = useCallback((id: string) => onSelect(id), [onSelect])

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
      <svg ref={svgRef} className="tree-canvas block h-full w-full touch-none" direction="rtl" onClick={() => onSelect(null)}>
        <defs>
          <linearGradient id="woodTrunk" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#2a1609" />
            <stop offset="0.18" stopColor="#5a371d" />
            <stop offset="0.42" stopColor="#94623a" />
            <stop offset="0.58" stopColor="#7a4c2a" />
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
          <linearGradient id="branchChild" x1="0" x2="0" y1="1" y2="0">
            <stop offset="0" stopColor="#4a2a14" />
            <stop offset="0.55" stopColor="#6b4423" />
            <stop offset="1" stopColor="#7b7236" />
          </linearGradient>
          <linearGradient id="branchWife" x1="0" x2="0" y1="1" y2="0">
            <stop offset="0" stopColor="#6b4423" />
            <stop offset="1" stopColor="#b8873a" />
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
          <Trunk scale={layout.trunkScale} />
          <BranchesLayer links={visibleLinks} />
          <NodesLayer nodes={visibleNodes} selectedId={selectedId} onSelect={handleSelect} onToggle={onToggle} onEdit={handleEdit} />
        </g>
      </svg>

      {actions && (
        <div
          ref={actionsRef}
          className="absolute z-20 -translate-x-1/2"
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

      <div className="absolute bottom-4 left-4 z-20 flex items-center gap-2 rounded-full bg-[#3b2412]/95 p-1.5 shadow-xl">
        <button
          type="button"
          onClick={() => centerTree(true)}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-amber-500 px-4 text-sm font-bold text-amber-950 transition hover:bg-amber-400"
        >
          <Crosshair className="size-4" />
          توسيط الشجرة
        </button>
        <button
          type="button"
          aria-label="تكبير"
          title="تكبير"
          onClick={() => zoomBy(ZOOM_STEP)}
          className="grid size-11 place-items-center rounded-full bg-white/10 text-amber-50 transition hover:bg-white/25"
        >
          <Plus className="size-6" strokeWidth={3} />
        </button>
        <span className="w-14 text-center text-sm font-bold text-amber-50 tabular-nums" dir="ltr">
          {zoomPercent}%
        </span>
        <button
          type="button"
          aria-label="تصغير"
          title="تصغير"
          onClick={() => zoomBy(1 / ZOOM_STEP)}
          className="grid size-11 place-items-center rounded-full bg-white/10 text-amber-50 transition hover:bg-white/25"
        >
          <Minus className="size-6" strokeWidth={3} />
        </button>
      </div>
    </div>
  )
}
