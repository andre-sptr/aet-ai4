# AET AI — Responsive & Visual QA

## Scope

Responsive review of the chat workspace for the Modern Hybrid Workspace light theme. Existing conversation behavior, API contracts, streaming, local history, Markdown rendering, and attachment handling were not intentionally changed.

## Viewport matrix

| Target | Viewport | Expected composition | Review outcome |
|---|---:|---|---|
| Desktop | 1440 × 900 | Full sidebar, centered reading column, three prompt cards, full toolbar | CSS structure reviewed; browser render not executed |
| Laptop | 1366 × 768 | Full sidebar, centered reading column, full toolbar | CSS structure reviewed; browser render not executed |
| Tablet landscape | 1024 × 768 | Compact sidebar, full-width main workspace | CSS structure reviewed; browser render not executed |
| Tablet portrait | 768 × 1024 | Compact sidebar, two-column prompt suggestions | Responsive refinement added; browser render not executed |
| Mobile | 390 × 844 | Sidebar drawer, compact topbar, single-column prompts, touch-friendly composer | Responsive refinement added; browser render not executed |
| Mobile compact | 320 × 700 | Reduced topbar actions, stacked composer controls, single-column content | Responsive refinement added; browser render not executed |

## Findings and changes

### P2 — Tablet portrait prompt cards were too dense

At 768px the desktop sidebar remains visible, leaving a narrow main canvas. Three equal prompt columns could make copy wrap excessively. Added a tablet-specific 2-column layout; the third prompt spans both columns.

### P1 — Mobile controls had undersized touch targets

Several mobile icon controls were approximately 29–33px and response actions were approximately 32px high. Added touch-first minimum dimensions for topbar, composer, response actions, code actions, citation links, and history rows.

### P1 — iOS may zoom the composer on focus

The mobile composer used 13px text. Increased mobile textarea text to 16px to avoid automatic focus zoom in iOS Safari and improve readability.

### P2 — Narrow mobile topbar could become crowded

At 360px and below, the history shortcut is hidden from the topbar; conversation history remains reachable from the mobile navigation drawer. The rename shortcut was already hidden in the mobile layout.

### P2 — Dialogs and mobile drawer need safe-area-aware scrolling

Added safe-area padding, internal scrolling, and overscroll containment for the mobile navigation drawer and dialogs.

### P3 — Hover affordances on touch devices

Added touch-device active states so the interface does not rely on hover feedback.

## Automated/static checks performed

- CSS parsed with `tinycss2`: no top-level parse errors.
- CSS brace balance: matched.
- Confirmed responsive rules exist for tablet (761–900px), mobile (≤760px), and compact mobile (≤360px).
- Confirmed reduced-motion rules remain present.
- Confirmed the chat layout uses `min-width: 0` on the main workspace and scroll containers for wide code/table content.

## Environment limitations

A full Next.js app build and actual browser screenshots could not be completed in this environment:

- Project declares Node.js `>=24.0.0`; the available runtime is Node.js `22.16.0`.
- `npm ci --ignore-scripts --no-audit --no-fund` timed out before dependencies were installed.
- The available headless Chromium launch/navigation was blocked by the execution environment (`ERR_BLOCKED_BY_ADMINISTRATOR`), so no actual application screenshots or computed-layout measurements are claimed.

The CSS/layout fixture used for structural inspection is not a substitute for a live Next.js browser run.

## Manual release checklist

Run with Node.js 24+ and the project's environment variables configured:

1. `npm ci`
2. `npm run typecheck`
3. `npm test`
4. `npm run build:web`
5. `npm run dev:web` and inspect the chat route in Chrome, Firefox, and Safari.
6. Verify 1440×900, 1366×768, 1024×768, 768×1024, 390×844, and 320×700.
7. Test mobile drawer open/close, keyboard focus, Escape behavior where supported, long messages, wide tables, long code blocks, citations, attachment previews, and the composer while the mobile keyboard is visible.
8. Test keyboard-only navigation and `prefers-reduced-motion`.

## Files changed

- `apps/web/components/chat/chat.css`

No API, database, conversation schema, or React interaction logic was changed in this responsive pass.
