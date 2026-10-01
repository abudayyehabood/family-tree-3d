# Known issues and how to fix them

Found by code review and browser testing on 2026-09-30 / 2026-10-01 (700-person stress tree and the
small demo family). Tests, typecheck, lint and the layout fuzz run are all green.

## Open

1. **Trunk and limbs are different wood.** The trunk uses the `woodTrunk` gradient (dark edges,
   light middle) while branches are flat `WOOD` with bark drawn over it, so the trunk top looks a
   shade lighter than the gen-1 limbs. *Fix:* make the gradient's middle stops closer to `WOOD`,
   or draw the bark highlight on the trunk column too.

2. **The crown leans.** Big families on one side make the canopy lopsided (on seed-tested 700-person
   trees the right side grows much taller than the left). *Fix:* weight `SPREAD` in
   `computeLayout` by subtree size, so heavy families take angle from both sides of the trunk.

3. **Cards are unreadable when the whole tree fits.** The 700-person tree is about 25k × 35k units,
   so fit-to-screen is around 2% zoom and the cards are specks. *Fix:* below about 10% zoom, draw
   one dot per card and only label the first 3 generations; show the full cards once zoomed in.

## Fixed (2026-10-01)

- **Branches had no wood grain.** Every branch now gets a shaded underside, a lit ridge and 3–4
  long veins that taper to a point, all following the branch's taper (`branchBark` in
  `geometry.ts`). The bark is switched off below 5% zoom, where it would be under a pixel.
- **Childless branches ended in sawn-off stumps.** A daughter or wife low in a big tree ended in a
  flat cut wider than her card. Branches nothing grows from now taper to a twig (`LEAF_TIP`).
- **The delete warning said "cannot be undone"**, though Ctrl+Z restores it. It now says you can undo.
- **Undo re-folded branches.** Undo/redo now keep whatever is open or folded right now (`keepFolds`).
- **Empty unknown-mother placeholders stayed in the data** after deleting their last child. They
  are removed now.
- **Adding a child always blamed the 15-generation limit**, whatever the real reason. It now says
  so only when that is the reason.
- **Crowded generation labels vanished** (gen 7 on the 700-person tree). A crowded label now steps
  up beside its generation before it hides; all 14 show on the stress tree.
