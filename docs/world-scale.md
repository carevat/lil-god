# World Scale Update

## What Limited the Original World

- The terrain, coordinate caches, picking, texture, radius, and save validator assumed 96 x 48 cells.
- There was a six-civilization hard cap, not a four-civilization cap.
- A 12-tile founding distance, limited usable land, and the old low-frequency land mask often
  exhausted suitable sites at one to four factions. Civilizations were not distributed at generation.
- Territory recomputation allocated a full grid for every civilization and then compared every
  tile against every faction. Soldiers repeatedly searched for unreachable targets across oceans.

## World Configuration

| Size | Grid | Radius | Surface vs. Original | Sparse / Normal / Dense Targets |
| --- | --- | --- | --- | --- |
| Small | 96 x 48 | 5 | 1x | 5 / 8 / 10 |
| Standard | 192 x 96 | 10 | 4x | 10 / 16 / 20 |
| Large | 240 x 120 | 12.5 | 6.25x | 13 / 20 / 25 |

Density uses minimum great-circle spacings of 19, 14, or 11 equatorial tile widths. The generator
reuses the existing coherent noise and biome rules, adding six irregular continental shelves,
secondary peninsulas, small island shelves, and ocean channels. There are at most three seeded
generation attempts. The best valid layout is used; unsupported or overlapping starts are not added.

Connected regions are measured with latitude-weighted area. Sites need fertile, non-polar land,
nearby vegetation, at least 18 local habitable tile-equivalents, and a region of at least 60.
Allocation visits distinct suitable regions first, then distributes extra settlements according to
region size. New factions use the existing citizen, economy, kingship and settlement simulation.

Existing terrain is never regenerated on load. Coordinate caches are keyed by dimensions, and all
gameplay proximity/pathfinding calls use the specific world's dimensions. Radius increases with
resolution, preserving physical tile scale and power footprints.

Military units retain the existing land-based navigation rules. Political wars can be declared
across water, but armies need a connected land route to reach another continent; this update does
not add naval transport. Unreachable targets no longer trigger repeated full path searches.

## Performance Measurements

Measured in the sandbox's Node/Vitest runtime, one worker. These are simulation CPU timings,
not claims about GPU frame rates on every laptop. Tests print fresh measurements when rerun.

| Scenario | Mean Tick | 95th Percentile |
| --- | --- | --- |
| Before changes: original 4 factions, 94 humans, war active | 3.805 ms | 5.761 ms |
| Optimized original workload, 89 surviving humans | 0.992 ms | 3.393 ms |
| Standard: 18,432 cells, 16 factions, 96 humans | 1.454 ms | 6.068 ms |
| Large stress: 28,800 cells, 25 factions, initially 500 humans + 80 animals, 4 wars | 4.412 ms | 11.026 ms |

The stress run ended with 477 humans, 69 animals, and 27 actual combat deaths. Before routing and
AI optimizations, a Large stress run averaged 14.866 ms per tick. The implementation did not reduce
the faction target to obtain the improvement.

Optimizations:
- Sparse territory claims, no full-grid-per-faction comparison.
- Connected-land rejection, bounded A*, and safe reusable path caching (paths copied before use).
- Per-tick spatial buckets and civilization-local building/settlement lists.
- Ecology spread over four deterministic shards, independent of the camera.
- Instanced sprites; trees are culled on the hidden hemisphere and omitted at overview distance.
- Cached pixel noise and terrain signatures skip unchanged pixel work; terrain uploads are throttled.
- All civilizations continue simulating off-screen. A 12-day run produced 155 completed buildings
  across all 16 starting factions and 11 births.

A Large/Lush/Dense save was 7,574,075 bytes as JSON and approximately 979,473 bytes in compressed
browser storage. Compression is lossless; JSON exports and old uncompressed snapshots remain supported.

## Verification

`npm test` covers the original systems plus size/density variation, deterministic continent layout,
settlement spacing, polar exclusion, coordinate round-trips, longitude wrapping, path-cache reuse,
surface entity/effect placement, high-index god powers, later founding beyond 16 factions, succession,
Divine Vision, expanded save round-trips, and unaltered populated legacy worlds.

`npm run test:browser` uses the production build and real pointer/keyboard actions to verify creation,
selection of a distant faction, focus/overview, picking, zoom limits, drag-vs-cast handling, Divine
Vision, meteor impacts, compressed saves, reloads, old-save import, size/density controls, and a
portrait viewport. Browser tests use Chromium software WebGL in the sandbox; physical touch-device
performance is not measured here.