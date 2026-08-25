# Stage 7 retained evidence

Generated from the local Vite application at `http://127.0.0.1:4173/` on 2026-08-25.

## Rendered width matrix

`width-results.json` records horizontal overflow, offscreen/clipped controls, panel overlap, layout mode, and visibility of Add, Connect, Open, Save, Undo, and Redo. Screenshots are retained for 1440, 1280, 1024, 820, 640, and 390 px. Desktop widths use the 12-column grid; 1024 px and below use the tab layout.

## Accessibility and interaction

- `keyboard-e2e.json` records the keyboard authoring path and the operating-system picker limitation.
- `accessibility-results.json` records focused DOM rules, semantic graph coverage, menu focus behavior, Inspector field associations, and error surfacing. These are project-focused automated checks, not an axe-core or manual screen-reader report.
- `contrast-results.json` contains computed WCAG contrast ratios for every node kind plus text-note and selected states in light and dark themes.
- `media-preferences-results.json` records rendered forced-colors and reduced-motion media emulation.
- `console-warnings-errors.json` contains browser warnings and errors captured after the interaction and viewport runs.

## Automated source verification

`npm.cmd run check` passed after the final implementation: TypeScript passed, all 11 Vitest files / 92 tests passed, the 4,000-node benchmark reported 8.43 ms compute and 52.14 ms interaction, and the production build completed. Vite retained its pre-existing large-chunk advisory; this is build output, not a browser console warning.

Manual screen-reader operation, accessibility API speech output, and keyboard operation inside the operating-system file picker are not claimed by this evidence set.
