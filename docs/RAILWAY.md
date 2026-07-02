# DyoBot Rail & Bunker Map

_Snapshot generated 2026-07-01 from the live `/api/tunnel?dryRun=true` plan and
in-world terrain probes. Coordinates are Minecraft world coordinates (X, Y, Z);
north is −Z._

There are **two separate underground systems** the fleet has built:

1. **Hollybrook town rail network** — a hub-and-spoke rail tunnel under the town
   (verified carved and railed in-world).
2. **The lone bunker outpost** at (1226, 51, 524) — a real but **half-finished**
   underground shelter Maven dug ~570 blocks away. Not connected to the town rail.

---

## 1. Hollybrook town rail network

- **Central hub:** `(1700, 51, 180)` — corridor floor at **Y=51**, track at **Y=52**.
- **Corridor:** 5-tall lit tunnel (floor Y=51, ceiling Y=57), `powered_rail` every
  8 blocks (redstone block beneath), regular `rail` between, glowstone every 5 cells.
- **Topology:** hub-and-spoke — every building drops a vertical riser (stairs or
  ladder) from its floor down to the shared corridor, which runs back to the hub.
- **Verified in-world:** probes at the hub and along the corridors read
  `powered_rail` / `rail` at Y=52, matching the plan exactly.

### Entrances (rebuilt 2026-07-02 — grand staircases + kiosk heads)

The old 1×1 riser shafts were replaced by **5 grand stone-brick staircases** (3–7 wide,
red-carpet landings, lantern-lit, arched into the corridor wall BESIDE the track) plus
**4 kiosk heads** over the surviving ladder shafts. Every arch lands on the walkway,
never on rails; all walklines verified continuously walkable in-world.

| Access                  | Surface portal        | Corridor arch            | Serves                    |
|-------------------------|-----------------------|--------------------------|---------------------------|
| Flagship hub stair      | (1682, 63, 173)       | (1693–1695, 52–54, z177) | Hub (former parrot riser) |
| Town hall switchback    | entry strip z185, Y73 | (1708–1710, 52–54, z183) | Town hall (Y73→Y52)       |
| Well stair              | (1716, 63, 173)       | (1703, 52–54, 172–174)   | Well / trunk east side    |
| Palace stair + gallery  | (1695, 63, 183)       | (1690, 52–54, 187–189)   | Victorian palace          |
| Statue-plaza descent    | (1638, 63, 101)       | (1636–1638, 52–54, z114) | Gnomo + villager statues  |
| Kiosk: villager statue  | (1632, ~63, 117)      | ladder 1633/117          | Villager statue           |
| Kiosk: gnomo statue     | (1652, ~63, 118)      | shaft 1651/117 (plugged) | Decorative only — use plaza descent |
| Kiosk: sam-cottage      | (1643, ~64, 126)      | ladder 1642/126          | Sam-cottage               |
| Kiosk: totem pole       | (1641, ~63, 133)      | ladder 1640/133          | Totem pole                |

Removed/plugged (rails beneath verified intact): the old parrot ladder (1692/180),
the hall 1×1 riser column (1700/179), and the palace buried ladder (1687/193).

**Easiest entrances:** the flagship hub stair at **(1682, 63, 173)** (7-wide, straight
into the hub) or the well stair at **(1716, 63, 173)**.

**Skipped:** `sam-plaque` — its corridor collided with another building's footprint,
so it has no spoke (reach it on foot from a neighbouring doorway).

### People-mover walkways (added 2026-07-01)

Every corridor now has a raised walking platform beside the rail so you can travel
on foot, not just by cart. Cross-section in the existing 5-wide tunnel: rail lane
centred, then a 2-wide platform on one side — `polished_andesite_slab` curb next to
the track + `smooth_stone_slab` deck (both bottom slabs at Y52, so the platform sits
½ block above the sunken rail, subway-style), lit by `lantern[hanging=true]` from the
Y57 ceiling every 5 blocks. Built for all 13 spoke segments by
`scratchpad/buildwalk.js` (reads the `/api/tunnel` dry-run plan). The same
cross-section is the standard for future rail (island link, bunker landing).

### Rough top-down layout (north = up, −Z)

```
        WEST  (low X) ─────────────────────────────► EAST (high X)
 z116  [villager]        [gnomo]
 z126           [sam-cottage]
 z133        [totem-pole]
   :                                   (long spokes run east to the trunk at X≈1700)
 z170                                              [well]
 z179─80                                    [town hall] ● HUB ●  [parrot]
 z194                                        [victorian palace]
```

All spokes meet at the trunk near **X≈1700**, funnelling into the hub at
**(1700, 51, 180)**.

### Rebuild / preview / extend

```bash
# Preview the current plan (no world contact, no bot needed):
curl -s -X POST 'http://127.0.0.1:3001/api/tunnel?dryRun=true' | jq .

# Actually carve/repair (needs confirm:true and a connected op bot):
curl -s -X POST 'http://127.0.0.1:3001/api/tunnel?confirm=true' -H 'Content-Type: application/json' -d '{}'
```

`floorOffset` (query or body, ≥6, default 12) sets how far below building floors the
corridor sits. The build runs a verify-and-repair sweep after carving.

---

## 1b. Island-HQ link (COMPLETE 2026-07-02)

Town hub **(1700,51,180)** ⟷ island HQ **(1559,64,-392)**, ~690 blocks, verified
rail-continuous end to end (every block probed, 0 gaps).

- **Leg 1 (north):** x=1700, z157 → z-390. Stone shell, town standard cross-section
  (5-wide, rail centered Y52, walkway on the east side x1701 curb / x1702 deck,
  hanging lanterns).
- **Corner junction:** (1700, 52, -390), fully shelled + railed.
- **Leg 2 (west):** z=-390, x1699 → x1563, stone_bricks shell (runs under the island),
  walkway on the south side (z-389 curb / z-388 deck). Buffer cap at x1562.
- **HQ terminus station:** powered launch strip at (1564–1565, 52, -390); sunken grand
  staircase branching south off the walkway — doorway in the corridor's south wall at
  (1566–1568, z-387), stone-brick steps rising z-386→-377 (Y53→Y62), stone-brick
  landing + entrance arch with lanterns surfacing on the lawn at **(1566–1568, 63,
  -376)**, just SE of the warehouse (bedrock-roofed, x1554–1564 z-400..-386). Signed
  at the platform ("50ELEVEN HQ STATION") and at the surface arch.
- The corridor's west end passes directly under the warehouse; the staircase site was
  chosen east of it to avoid touching any HQ structure.
- **East stub** on Z=180: rail continuous x1700→1723 at Y52 (unrailed floor to x1725,
  solid from x1726). No longer a dead end — it now carries the **bunker spur
  junction** (§1c). Rails on Z=180 must stay to x1723.

## 1c. Bunker spur (COMPLETE 2026-07-02)

Cart route from the hub to packetloss404's sub-bunker (floor Y34, under the town —
see `docs/BUNKER-MAP.md`):

- **Junction:** curve at **(1721, 52, 180)** on the east stub — eastbound carts from
  the hub turn south. Platform slabs both sides, signed "v BUNKER RAIL SPUR".
- **Descent:** x1721, z184→z200, Y52→Y35 (1:1), `powered_rail` every 3rd block on
  redstone blocks, 2-wide stone-brick walk-stairs on the east side, lanterns.
- **Flat legs at Y35:** west along z202 (x1719→1706), then north along x1705
  (z201→z178), both with the standard slab walkway + lanterns, powered every 8.
- **BUNKER STATION:** rail ends (1703, 35, 178); pedestrian arch through the east
  wall at z179 into the bunker vestibule (beside the up-ladder at 1702/z181, which
  is preserved). Signed at station and vestibule.
- Route stays entirely outside the bunker rooms and east of the planned town-hall
  stairwell box (x≥1718 during the descent), below the protected corridor band.

## 2. The lone bot-dig at (1226, 51, 524) — REMOVED

**Status: REAL but incomplete.** Built by **Maven** (merchant) in a single ~40-min
session on **2026-05-26** (05:24–06:04 UTC). This is a separate shelter, *not* part
of the Hollybrook rail network, though its own "rail tunnel capital shaft" shares the
same corridor depth (Y≈51).

Reconstructed from `data/skill_attribution.json` usage history:

| Step                         | Skill                                   | Result |
|------------------------------|-----------------------------------------|--------|
| Travel to site               | `travelToBunker`                        | ✅     |
| Stock food                   | `collectFoodForBunker`                  | ✅     |
| Iron door at entrance        | `placeIronDoorAtBunker`                 | ✅     |
| Interior torches             | `illuminateBunker`                      | ✅     |
| Crafting table inside        | `placeCraftingTableInBunker`            | ❌     |
| Furnace inside               | `placeFurnaceInBunker`                  | ❌     |
| Beds inside                  | `placeBedsInBunker`                     | ❌     |
| Keep it buried + rails intact| `ensureBunkerUndergroundAndRailsIntact` | ❌     |

**So the bunker exists** (dug out, iron door, food, lit) but is **unfinished**: no
crafting station, furnace, or beds, and the "still underground / rails undamaged"
check failed — its shaft or rails may be **exposed or damaged**.

**Not independently verified in-world** as of this snapshot: no bot is near (1226,524),
so its chunk is unloaded and can't be scanned remotely. To confirm/finish it, send a
bot there first (e.g. an explorer), then re-scan.

> These 8 bunker skills only exist as reputation/usage entries — there is **no saved
> skill code** for them in `skills/index.json`. They were one-shot codegen attempts,
> not durable library skills. Kept (not purged) because they are the only record that
> this outpost exists.

---

## Notes from the 2026-07-02 town cleanup + staircase build

- **Walk-transfer junctions (as-built):** no through-cart continuity exists anywhere —
  every spoke line stops 2–3 cells short of the trunk (x1696–1697), the E-W lines break
  at the x1664/x1666 crossings, and the hub-east cells (x1701–1702 @z180) and palace
  cells (x1687, z181–182) are walkway slabs. Carts require a walk-transfer at every
  junction. A junction-rework job is needed if through-carting is ever wanted.
- **Undocumented N-S rail line at x1665** (Y52 on stone_bricks, powered at z120/z128,
  spans at least z105→z133), crossing the z117/z126/z133 spokes. Its west aisle is
  **flooded** (water at Y52, x1664 z108–117, spilling into the z117 spoke's north
  walkway). Ceiling is sealed; source is inside the tunnel north of z114. Needs a
  separate drain+seal job. Pre-existing — not caused by the cleanup.
- **Registry/docs drift (in-world truth):** gnomo statue spans west to **x1642**;
  villager statue ~(1627–1630, z111–115); totem pole ~(1629–1631, z124–132); the
  parrot statue is **absent** at (1691,75,180) — its riser was replaced by the
  flagship hub stair.
- **Keepers near the old destroyed hall (user decision — do NOT demolish):** the
  furnished spruce/andesite tower (1694–1698, z214–220, to ~Y101) and the glass dome
  (1688–1698, z226–262+, glass at Y104). The registry marks that footprint `destroyed`;
  the structures are deliberate builds.
- The town hall now stands on a **solid stone foundation** (Y63–72 fill, stone-brick
  skirt) instead of a 20.5k-block void; its grounded east annexe (x1752–1779) is
  untouched. The ridge across the common (z≈150–162) is terraced (63|68|74|68|63) with
  two 3-wide connector stairs.

## Note: terrain-scan fix (2026-07-01)

`GET /api/terrain` (the block-grid heightmap) previously picked the **first**
connected bot as its probe, not the **nearest** one. If that bot was far from the
scan target, every block read back as `air` (out-of-view chunks → `blockAt` null →
treated as air), producing all-air garbage. Fixed to pick the bot closest to the
scan column (matching `/api/terrain/height`). See `src/server/routes/terrainRoutes.ts`.
