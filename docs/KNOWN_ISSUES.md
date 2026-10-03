# Known issues and how to fix them

Found by code review and browser testing on 2026-09-30 / 2026-10-01 (700-person stress tree and the
small demo family). Tests, typecheck, lint and the layout fuzz run are all green.

## Open

None known.

## Fixed (2026-10-03)

- **Limbs ran far longer than they needed.** Every generation sat on one shared ring, so one limb that
  had to swing far sideways (or one crowded corner) pushed the whole ring out and lengthened every limb
  of that generation. After the rings settle, `pullIn` slides each family back in along its angle as far
  as its own limb's length and turn allow, without touching another card or crossing another limb.
  On the 700-person tree limbs are about 2.7× shorter and the crown about half the size.
- **The crown leaned.** The fan was centred on the middle of the family's span, so one big family
  made the canopy lopsided. It now centres on where the people are (`BALANCE`).
- **Trunk and limbs were different wood.** The trunk gradient now runs through the limbs' `WOOD`.
- **Cards were specks when the whole tree fits.** Below 10% zoom every card is a coloured dot of fixed
  screen size (green son, pink daughter, amber wife); the selected card stays a full card.
- **There was no way back from "open all".** "طي حتى الجيل 4" folds the tree back to generation 4
  (3 on a phone), the same view a new 700-person tree opens with.

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
