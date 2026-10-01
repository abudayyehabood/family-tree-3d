// Undo is the safety net for irreversible edits, so its reducer is the one piece of logic here
// that is covered. Run with `npm test`.
import { createJiti } from 'jiti'
import assert from 'node:assert/strict'
import { test } from 'node:test'
const jiti = createJiti(import.meta.url)
const R = new URL('../src/', import.meta.url).pathname
const { historyReducer } = await jiti.import(R+'lib/history.ts')
const { createDemoFamily } = await jiti.import(R+'lib/generators.ts')
const { buildIndex, addWife, addChildToHusband, deleteNode, renameNode, toggleCollapse } = await jiti.import(R+'lib/tree.ts')

const names = r => [...buildIndex(r).values()].map(e=>e.node.name).sort().join(',')
let s = { root: createDemoFamily(), past: [], future: [] }
const commit = u => (s = historyReducer(s, { type:'commit', update:u }))
const view   = u => (s = historyReducer(s, { type:'view',   update:u }))
const undo   = () => (s = historyReducer(s, { type:'undo' }))
const redo   = () => (s = historyReducer(s, { type:'redo' }))

const start = names(s.root)
const results = []

// 1. delete a whole branch, then undo it
const fatima = [...buildIndex(s.root).values()].find(e=>e.node.name==='فاطمة').node
commit(r => deleteNode(r, fatima.id))
assert.notEqual(names(s.root), start)
undo()
results.push(['undo restores a deleted branch exactly', names(s.root) === start])

// 2. redo puts it back
redo()
assert.notEqual(names(s.root), start)
undo()
results.push(['redo then undo returns to the original', names(s.root) === start])

// 3. collapse/expand must NOT consume an undo step
const before = s.past.length
const ahmad = [...buildIndex(s.root).values()].find(e=>e.node.name==='أحمد').node
view(r => toggleCollapse(r, ahmad.id))
results.push(['collapsing does not push history', s.past.length === before])

// 4. a new edit clears the redo branch
const abdullah = [...buildIndex(s.root).values()].find(e=>e.node.name==='عبد الله').node
commit(r => addWife(r, abdullah.id, 'زوجة جديدة')?.root ?? r)
undo()
assert.equal(s.future.length, 1)
commit(r => renameNode(r, abdullah.id, 'عبد الله الأول'))
results.push(['a fresh edit clears the redo stack', s.future.length === 0])

// 5. a no-op change must not create a history entry
const n = s.past.length
commit(r => renameNode(r, abdullah.id, 'عبد الله الأول'))
results.push(['renaming to the same name pushes nothing', s.past.length === n])

// 6. undo at the very beginning is a no-op, not a crash
let t = { root: createDemoFamily(), past: [], future: [] }
const same = historyReducer(t, { type:'undo' })
results.push(['undo with empty history is a no-op', same === t])

// 7. history is capped and keeps the MOST RECENT entries
let u = { root: createDemoFamily(), past: [], future: [] }
for (let i=0;i<80;i++) u = historyReducer(u, { type:'commit', update:r=>renameNode(r, r.id, 'n'+i) })
results.push(['history caps at 60 entries', u.past.length === 60])
for (let i=0;i<60;i++) u = historyReducer(u, { type:'undo' })
results.push(['60 undos walk back without breaking', u.past.length === 0 && u.future.length === 60])

// 8. structural sharing: undo entries must not be deep copies
const deep = [...buildIndex(s.root).values()].find(e=>e.node.name==='يوسف')
const shared = s.past.length && s.past.at(-1)
let sharedSubtree = false
if (shared) {
  const a = buildIndex(shared).get(deep.node.id)?.node
  sharedSubtree = a === deep.node
}
results.push(['untouched branches are shared, not copied', sharedSubtree])

// 9. undo keeps whatever is folded right now (folding is a view, not an edit)
let f = { root: createDemoFamily(), past: [], future: [] }
const ahmad2 = [...buildIndex(f.root).values()].find(e=>e.node.name==='أحمد').node
f = historyReducer(f, { type:'commit', update:r=>renameNode(r, r.id, 'x') })
f = historyReducer(f, { type:'view', update:r=>toggleCollapse(r, ahmad2.id) })
f = historyReducer(f, { type:'undo' })
results.push(['undo does not reopen a folded branch', buildIndex(f.root).get(ahmad2.id).node.collapsed === true && f.root.name !== 'x'])

// 10. deleting a man's last child of an unknown mother removes the empty placeholder too
const fam = createDemoFamily()
const ahmad3 = [...buildIndex(fam).values()].find(e=>e.node.name==='أحمد').node
const kid = addChildToHusband(fam, ahmad3.id, 'male', 'ولد')
const after = deleteNode(kid.root, kid.id)
results.push(['no empty unknown mother is left behind', !buildIndex(after).get(ahmad3.id).node.children.some(w=>w.unknown)])

for (const [name, ok] of results) test(name, () => assert.ok(ok))
