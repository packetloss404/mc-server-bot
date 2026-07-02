# Bunker Outpost — (1226–1227, ~40–61, 524)

_Verified 2026-07-01 by a 4-agent investigation + direct block probes, with Maven
pinned on-site to keep chunks loaded. This corrects the earlier assumption that
the bunker was a furnished shelter with rooms._

## What's actually there (ground truth)

The "bunker" is **not** a built shelter with bedrooms. It is a **narrow natural
cave shaft** that a bot (Maven, 2026-05-26) partially worked on and abandoned:

- **Shaft column:** (1227, 524). Roughly 2–3 blocks wide.
- **Vertical profile (verified at 1227,524):**
  - Y64 `dirt_path` (surface)
  - ~~Y51–61 `water`~~ → **DRAINED 2026-07-01**, now capped `stone` Y59–61, air Y51–58
  - Y48–50 **`diamond_block`** — a 3-block emergency plug a bot placed; it held and
    kept the lower shaft dry. **Left in place (27 diamonds).**
  - Y45 `ladder`, Y41–43 `cobblestone`, Y40 `ladder`, Y38–39 `stone` (floor)
- **Lower cave:** floor ~Y39, a cramped diorite/stone pocket lit by ~17
  `sea_lantern`s along the west edge (x1217). No rooms.
- **Fixtures present:** sea lanterns, ladders, the diamond plug, cobblestone patching.
- **Fixtures ABSENT:** no iron door, no chests/food store, no crafting table, no
  furnace, no beds, **no rails of any kind.** (Despite the skill history claiming
  an iron door + food were placed — they are not in-world.)

So the name "rail tunnel capital shaft" is aspirational: there is a vertical
ladder shaft, no rail, and no capital.

## Why the `ensureBunkerUndergroundAndRailsIntact` skill failed

All three of its checks were genuinely broken: (1) rails — none exist; (2)
underground — the shaft was open to the sky; (3) intact — the upper shaft had
flooded from a surface pond (Y60–62) pouring down the opening.

## Built on 2026-07-01

- **Drained the flooded upper shaft.** Sealed the shaft throat from the surface
  pond with a `stone` cap (Y59–61) so it can't refill, then cleared the water
  Y51–58. Verified dry with no reflow. Diamond plug and everything below untouched.

- **Excavated + built the full bunker complex** (since there was nothing to
  subdivide, it was dug from scratch). Hall footprint **x1220–1234 / z517–531 /
  floor Y40, ceiling Y46** — `stone_bricks` shell, `smooth_stone` floor, `oak_planks`
  in the rooms. Interior x1221–1233 / z518–530, 5 tall.
  - **Layout:** central east-west corridor (z523–525) with four rooms off it —
    **APT 1** (NW, red bed + chest), **Utility** (NE: 2 furnaces, blast furnace,
    2 crafting tables, storage chests), **Commons** (SW: smoker, barrels, chests,
    barracks beds), **APT 2** (SE, blue bed + chest). Doorways cut into the corridor
    walls at x1223/x1230.
  - **Entrance:** a dry, walled `ladder` shaft at **(1230, 524)** from the hall
    floor (Y41) up to a surface hatch at Y64 (stone-brick rim + oak-fence ring +
    sign), routed **east of the diamond plug so the diamonds are preserved** and
    embedded as a labelled "OLD SEAL" feature.
  - **Lit** with hanging `lantern`s; **signed** throughout (entrance, directory,
    room labels, diamond-plug warning).

## Still open

- **Rail landing + link:** the bunker has no rails yet and is not connected to the
  town/island network. Its people-mover rail spur is a future extension (the town
  network + walkway standard are done; see `docs/RAILWAY.md`).

## Access note

The bunker is ~570 blocks from Hollybrook, outside the fleet's normal range. Bots
aren't leashed there, and standing in the (former) shaft water triggered the
stranded-in-liquid auto-rescue that teleports a bot back to the island — so any
on-site build needs a bot parked on a **dry** spot (e.g. 1228,40,526) and pinned.
