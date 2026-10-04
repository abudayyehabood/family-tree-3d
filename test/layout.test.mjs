// The crown layout is the heart of the app: with every branch open, no two cards may overlap and the
// founder stays on the trunk top. Run with `npm test`.
import { createJiti } from 'jiti'
import assert from 'node:assert/strict'
import { test } from 'node:test'
const jiti = createJiti(import.meta.url)
const R = new URL('../src/', import.meta.url).pathname
const { computeLayout, cardHalf } = await jiti.import(R + 'lib/treeLayout.ts')
const { createDemoFamily, createStressTree } = await jiti.import(R + 'lib/generators.ts')
const { addChild, buildIndex, expandAll, foldToGeneration } = await jiti.import(R + 'lib/tree.ts')

/** Limbs that run under a card other than their own two ends (the card hides them; they seem to grow from it). */
function limbsUnderCards(layout) {
  let hits = 0
  for (const l of layout.links)
    for (const n of layout.nodes) {
      if (n.id === l.id || n.id === l.from) continue
      const { hw, hh } = cardHalf(n.type, !!n.husband)
      if (l.box.maxX < n.x - hw || l.box.minX > n.x + hw || l.box.maxY < n.y - hh || l.box.minY > n.y + hh) continue
      if (l.spine.slice(1, -1).some(([x, y]) => Math.abs(x - n.x) < hw && Math.abs(y - n.y) < hh)) hits++
    }
  return hits
}

/** Limbs that run flat or downhill: the child must sit higher than its parent by a third of the way it reaches sideways. */
function fallingLimbs(layout) {
  return layout.links.filter((l) => {
    const [p, c] = [l.spine[0], l.spine[l.spine.length - 1]]
    return 0.35 * Math.abs(c[0] - p[0]) - (p[1] - c[1]) > 5
  })
}

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
    assert.ok(crossings <= 3, `${crossings} crossing branches`)
    assert.equal(limbsUnderCards(layout), 0, 'limbs running under other cards')
  })
}

test('folded and small trees: every limb climbs and none runs under another card', () => {
  const views = [['demo', createDemoFamily()]]
  for (const seed of [7, 42]) for (const generation of [3, 4, 6]) views.push([`seed ${seed} folded at ${generation}`, foldToGeneration(expandAll(createStressTree(seed)), generation)])
  for (const [name, root] of views) {
    const layout = computeLayout(root, buildIndex(root))
    assert.equal(limbsUnderCards(layout), 0, `${name}: limbs under cards`)
    assert.deepEqual(fallingLimbs(layout).map((l) => layout.byId.get(l.id).name), [], `${name}: flat or falling limbs`)
  }
})

test('limbs are no longer than they need to be', () => {
  // The rings once fed back on themselves (a bigger crown made a thicker trunk and longer limbs), so a
  // 27-card view stood 1790 tall with the founder's wife 247 away instead of 85.
  const root = foldToGeneration(expandAll(createStressTree(20260926)), 4)
  const layout = computeLayout(root, buildIndex(root))
  assert.ok(layout.bounds.maxY - layout.bounds.minY < 1300, `folded crown ${Math.round(layout.bounds.maxY - layout.bounds.minY)} tall`)
  const len = (l) => Math.hypot(l.spine.at(-1)[0] - l.spine[0][0], l.spine.at(-1)[1] - l.spine[0][1])
  const lens = layout.links.map(len).sort((a, b) => a - b)
  assert.ok(lens[lens.length >> 1] < 220, `median limb ${Math.round(lens[lens.length >> 1])}`)
  const open = expandAll(createStressTree(20260926))
  const big = computeLayout(open, buildIndex(open))
  assert.ok(big.bounds.maxY - big.bounds.minY < 23000, `open crown ${Math.round(big.bounds.maxY - big.bounds.minY)} tall`)
})

test('a child added to an early generation grows up from its mother, not sideways or down', () => {
  const start = foldToGeneration(expandAll(createStressTree(20260926)), 4)
  const before = computeLayout(start, buildIndex(start))
  for (const wife of before.nodes.filter((n) => n.type === 'wife' && n.generation <= 3)) {
    const { root, id } = addChild(start, wife.id, 'male', 'جديد')
    const layout = computeLayout(root, buildIndex(root))
    const [kid, mother] = [layout.byId.get(id), layout.byId.get(wife.id)]
    assert.ok(mother.y - kid.y >= 0.35 * Math.abs(kid.x - mother.x) - 5, `new child of ${wife.name} does not climb`)
  }
})

test('every branch leads back to the founder, and each generation gets one label', () => {
  const root = expandAll(createStressTree(7))
  const layout = computeLayout(root, buildIndex(root))
  const founder = layout.nodes.find((n) => n.isRoot)
  const byChild = new Map(layout.links.map((l) => [l.id, l]))
  for (const l of layout.links) {
    let at = l
    for (let hops = 0; at && hops < 40; hops++) at = byChild.get(at.from) ?? (at.from === founder.id ? null : at)
    assert.equal(at, null, `branch to ${layout.byId.get(l.id).name} never reaches the founder`)
  }
  const gens = layout.rings.map((r) => r.generation)
  assert.deepEqual(gens, [...new Set(gens)].sort((a, b) => a - b))
  assert.equal(gens.length, 14, 'generations 2–15')
})

test('folding to a generation shows exactly the generations above it', () => {
  const root = foldToGeneration(expandAll(createStressTree(7)), 4)
  const shown = []
  const walk = (n) => {
    shown.push(n.generation)
    if (!n.collapsed) n.children.forEach(walk)
  }
  walk(root)
  assert.equal(Math.max(...shown), 4)
  const again = foldToGeneration(root, 4)
  assert.equal(again, root, 'folding twice changes nothing')
})
