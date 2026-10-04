# Known issues and how to fix them

Found by code review and browser testing on 2026-09-30 / 2026-10-01 (700-person stress tree and the
small demo family). Tests, typecheck, lint and the layout fuzz run are all green.

## Open

- **A big family far to the side hangs off one long limb when everything is open.** A wife sits over the
  middle of her own descendants, so in the open 700-person tree a husband→wife limb can reach 10,000
  sideways. It climbs between the rows and stays clear of cards, but it is long.
- **On a phone held upright the tree is small.** Rows make the crown wider than tall, which suits desktop
  screens. Turn the phone sideways, or zoom in.
- **Two limbs from one parent can braid** where one reaches a staggered row's upper tier and the other
  its lower one (about 6 pairs with 700 open; none between different families).
- **Adding one person to a fully open big tree moves many cards.** A new card widens its row, so the
  families beside it shift over. Folded views barely move.
- **Generation labels are large next to a tiny tree on a phone at 1–5% zoom** and cover the left
  branch; crowded ones hide.

## Fixed (2026-10-05)

- **Limbs swept across the whole crown; the tree was three times wider than tall.** A row of many small
  families (17 cards in a 39-card view) laid flat side by side was as wide as all its cards, so every
  wife and son below it sat far out and their limbs ran almost flat across the screen. A crowded row of
  children (`TIER_CARDS`) now packs every other card a little higher (`TIER_RISE`), so neighbours overlap
  sideways and the row is about half as wide. Limbs pass straight up through the gap between the cards
  beside theirs and bend only clear of the row. That view went from 2482 wide to 1572 (957 to 899 tall),
  average limb 301 to 239; the open 700-person tree from 23.7k wide to 14.3k.

- **Limbs were far longer than needed; the tree was tall and narrow, with empty space either side.**
  Every generation sat on a ring round the founder. A ring near the trunk is short, so a family that did
  not fit side by side on it pushed the whole ring up; so did one limb that had to reach far sideways
  (to climb), and every other limb of that generation grew with it. `pullIn` brought some back, but the
  cards jammed each other. Each generation is now a straight row, as wide as its people need, and only
  as far above the last as its limbs need (`CLIMB`, capped at `MAX_CLIMB_STEPS`). A 1509-person tree
  folded to 39 cards went from 1372 to 957 tall (fits at 66% instead of 49%), the folded 700-person
  tree from 998 to 755, and the open one from 19.6k to 7.7k tall. Layout of 700 open: 1.4s to 0.25s.
  A limb reaching far sideways leaves straight up and crosses between the rows, not under its
  neighbours' cards.

## Fixed (2026-10-04)

- **Limbs grew longer than needed, most of all in folded views.** Two causes. The trunk scaled with the
  crown's size, and a thicker trunk made every limb thicker, and so longer, which grew the crown again.
  The folded 700-person tree stood 1790 tall (now ~1000), and the founder's wife sat 247 away instead
  of 85. Also, the room a ring got so its limbs could turn and climb was added up attempt after attempt,
  so a guess made before the angles settled pushed rings out for good. Now the trunk scales with the
  number of cards shown, and the turn/climb room is worked out afresh each attempt, capped per ring
  (`MAX_RING_CLIMB`). A flank card that would sit level with its parent narrows its ring's fan instead.
  The open 700 tree went from 28.4k to 19.6k tall.

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
