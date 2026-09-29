// The crown layout is the heart of the app: with every branch open, no two cards may overlap and the
// founder stays on the trunk top. Run with `npm test`.
import { createJiti } from 'jiti'
import assert from 'node:assert/strict'
import { test } from 'node:test'
const jiti = createJiti(import.meta.url)
const R = new URL('../src/', import.meta.url).pathname
const { computeLayout, cardHalf } = await jiti.import(R + 'lib/treeLayout.ts')
const { createStressTree } = await jiti.import(R + 'lib/generators.ts')
const { buildIndex, expandAll } = await jiti.import(R + 'lib/tree.ts')

for (const seed of [20260926, 42]) {
  test(`700-person crown (seed ${seed}): no overlapping cards`, () => {
    const root = expandAll(createStressTree(seed))
    // Marry every third daughter, so the wide ∞ couple cards are part of the packing.
    let k = 0
    const marry = (n) => {
      if (n.type === 'member' && n.gender === 'female' && k++ % 3 === 0) n.husband = 'سعيد'
      n.children.forEach(marry)
    }
    marry(root)
    const layout = computeLayout(root, buildIndex(root))

    const founder = layout.nodes.find((n) => n.isRoot)
    assert.deepEqual([founder.x, founder.y], [0, 0])
    assert.equal(layout.links.length, layout.nodes.length - 1, 'one branch per card except the founder')

    const boxes = layout.nodes.map((n) => ({ n, ...cardHalf(n.type, !!n.husband) }))
    boxes.sort((a, b) => a.n.x - b.n.x)
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i]
      for (let j = i + 1; j < boxes.length && boxes[j].n.x - a.n.x < 300; j++) {
        const b = boxes[j]
        const overlap = Math.abs(a.n.x - b.n.x) < a.hw + b.hw && Math.abs(a.n.y - b.n.y) < a.hh + b.hh
        assert.ok(!overlap, `${a.n.name} (gen ${a.n.generation}) overlaps ${b.n.name} (gen ${b.n.generation})`)
      }
    }

    // Branches may touch where they fork, but hardly any may cross further along (a tangle).
    const cross = (p, q, r, s) => {
      const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
      return d(p, q, r) * d(p, q, s) < 0 && d(r, s, p) * d(r, s, q) < 0
    }
    const apart = (a, b) => a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY
    let crossings = 0
    for (let i = 0; i < layout.links.length; i++) {
      for (let j = i + 1; j < layout.links.length; j++) {
        const [a, b] = [layout.links[i].spine, layout.links[j].spine]
        if (apart(layout.links[i].box, layout.links[j].box)) continue
        let hit = false
        for (let u = 1; u < a.length - 2 && !hit; u++) for (let v = 1; v < b.length - 2 && !hit; v++) hit = cross(a[u], a[u + 1], b[v], b[v + 1])
        if (hit) crossings++
      }
    }
    assert.ok(crossings <= 10, `${crossings} crossing branches`)
  })
}
