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
  })
}
