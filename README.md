# شجرة العائلة (Organic Family Tree)

An Arabic, right-to-left family tree drawn as a living tree: trunk, roots, green canopy, and tapered wooden branches.

## Features

- Upward polar canopy layout (`src/lib/treeLayout.ts`): wives 85px from the husband, children 140px from the mother, no overlapping cards.
- Click any person to open the side panel: rename («حفظ الاسم» or Enter), add wife (up to 4), add son/daughter, collapse/expand, delete.
- Double-click any card to rename it directly on the tree.
- Zoom dock (+ / − / percentage / «توسيط الشجرة»), search with auto-expand, JSON import/export, auto-save to `localStorage`.
- Stress test: 1,500 people across 15 generations, collapsed from generation 4.

## Rules

- A male member can have up to 4 wives; children are added under a wife.
- If the mother's name is unknown, add sons/daughters straight to the man; their branches grow directly from him (no wife card). Type the mother's name later in his panel to turn her into a named wife.
- A female member is a leaf. Maximum depth is 15 generations.

## Run

```bash
npm install
npm run dev
```

Build with `npm run build`.
