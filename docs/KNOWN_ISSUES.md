# Known issues and how to fix them

Found by code review and browser testing on 2026-09-30 / 2026-10-01 (700-person stress tree and the
small demo family). Tests, typecheck, lint and the layout fuzz run are all green.

## Open

- **Laying out the full 700-person tree takes about 1.5s** (0.35s before `pullIn`; the limb-under-card
  and crossing checks cost the rest). Fine for an "open all" click; move `computeLayout` into a worker
  if trees get much bigger.
- **With everything open, a big family far to the side still hangs off one long limb.** A family sits at
  the centre of its descendants, so the limb to it must reach that far; it climbs at a slant, but it is long.
- **Adding one person to a fully open big tree moves many cards.** The layout is global (rings, even
  spreading), so a new card in a crowded ring shifts its neighbours. Folded views barely move.
- **Generation labels are large next to a tiny tree on a phone at 1–5% zoom** and cover the left
  branch; crowded ones hide.

## Fixed (2026-10-04)

- **A child added to an older generation could grow sideways or downhill.** Near the trunk the rings are
  small, so a card far round one sat level with (or below) its parent. Inner generations now fan out less
  (`fanOf`), and a ring moves out until each limb climbs at least a third of its sideways reach (`CLIMB`).
- **Limbs ran under other cards** after `pullIn` (8 in the small demo, ~250 with 700 open; 0 before it).
  `pullIn` now rejects any move that puts a limb under a card or a card on a limb. Tested.
- **Two wives of the founder stacked one behind the other.** A ring only splits into two rows from 4 cards.
- **On a phone the fitted tree used half the screen.** The fit now frames the crown and roots, not the
  whole hill, with a narrow margin.
- **The desktop search box shrank to a stub** at 1024–1535px. Tool labels show from 1536px; below that
  the buttons are icons with tooltips.

- **Branches were as thick as their generation, not their family.** A childless daughter of the founder
  got a limb as thick as her brother's that carries hundreds. Width now grows with the square root of
  the people on the branch (`FAMILY_WIDTH`, capped by the generation width), so small families are twigs.
- **Some limbs were still long for no reason.** `pullIn` moved a family as one block, so one stuck
  grandchild held everyone out. Now each card comes in as far as its parent did if it can (else half,
  else stays), it sweeps up to three times, and checks the family's own cards and limbs against each other.
  A card still sits clear of the wood it grows from (`KNOT_CLEAR`).
- **Names were small.** Cards are 15% bigger and names about 25% bigger.

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
