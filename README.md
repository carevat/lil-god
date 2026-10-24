# LITTLE GOD

A pixel-art god simulator on a tiny spherical planet. Create people, animals and golems, watch civilizations
grow, trade tension for war, and shape (or scar) the world with divine powers.

## Expanded Worlds

New worlds offer Small, Standard, and Large sizes plus Sparse, Normal, and Dense civilization
density. Standard is the default: 192 x 96 terrain regions and radius 10, four times the surface
area of the original 96 x 48, radius-5 planet. Its normal target is 16 independent civilizations.
Large has 240 x 120 regions; Dense targets 25 civilizations. Counts are limited by validated land
and spacing, not a fixed faction cap. Unsuited islands and polar regions are never forced into use.

Select a civilization in the searchable Civs list to fly to it. Click a person in People, use
**Focus here** in the inspector, or click a settlement name to zoom in. **Overview** (O) returns
to the complete globe. Drag to rotate and wheel/pinch to zoom still work during ordinary play;
dragging cancels a camera flight without triggering a power.

Only explicit world creation uses the expanded generator. Existing saves retain their original
terrain, dimensions, entities, wars, and royal succession. Version 5 snapshots are gzip-compressed
in browser storage; exported saves remain readable JSON. Versions 1 through 4 still load.

Human creation and new settlements avoid the outer 18% of both poles. Clicking polar land with
Create Life relocates newcomers to habitable land and explains the move. Existing polar inhabitants
are preserved. When a king dies, the highest-authority survivor is designated immediately; the
people panic for nine simulated hours, then the new king is crowned. Saving mid-crisis preserves
its timing and prevents duplicate coronations. Both values are configurable in `src/game/config.ts`.

## Commands
- `npm install` — install dependencies
- `npm run dev` — start the dev server
- `npm test` — run the simulation unit tests (Vitest)
- `npm run build` — production build to `dist/` (single static `index.html`, deployable to Vercel)
- `npx tsc --noEmit` - strict type check
- `npx playwright install chromium` - install the browser used for interaction tests
- `npm run test:browser` - test the production build (run `npm run build` first)

## Layout
- `src/game/` — authoritative simulation (no React): `simulation.ts` (tick), `humans.ts`, `wildlife.ts`, `civ.ts`
  (territory, diplomacy, war), `powers.ts`, `lifecycle.ts` (shared damage/death), `species.ts` + `config.ts` (all balance data),
  `migrate.ts`/`persistence.ts` (versioned saves; v1-v4 worlds are migrated), `store.ts` (UI bridge)
- `src/game/grid.ts`, `geography.ts`, `newWorld.ts`, `scale.ts` - per-world coordinates, continental
  generation, habitable-region validation, distributed founding, and size/density configuration
- `src/rendering/` — React Three Fiber scene, instanced sprite batch, terrain texture, particles
- `src/components/` — interface panels
- `src/tests/` — unit tests

Saves live in `localStorage` (autosave every 20s). Debug hook for automation: `window.__LG` (the store).

See `docs/world-scale.md` for measured performance, compatibility details, and test coverage.
