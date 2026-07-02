# Hollybrook Sub-Bunker — Living Map & Build Log

_packetloss404's player-built bunker, deep under Hollybrook town. This is the
working blueprint — **update it every time we build out a room.** Mapped 2026-07-01
by walking a bot (Eleven) across it and stitching local scans; boundaries then
verified block-by-block._

## Coordinates & shell (verified)

- **Floor:** Y34 (`polished_andesite` / `light_gray_concrete`)
- **Ceiling:** Y44 (`gray_concrete` underside; `stone_bricks` Y45, stone Y46 above)
- **Interior height:** Y35–43 = **9 blocks tall** (this is why it feels cavernous)
- **West wall:** x1668 (interior starts x1669)
- **Extent:** roughly **x1669–1700 wide, z161–200 long**
- **Up-exit:** `ladder` at **(1702, z181)**, east end → climbs toward the town rail
  hub at (1700, 51, 180), ~17 blocks above.

## Layout — three bands (divider walls at z176 and z186, each with a door gap)

```
      x1668 ──────────────────────────────► x1701
 z161 ┌────────────────────────────────────┐  NORTH BAND (z161–175)
      │        ┌───────┐                    │  internal room block x1677–1683
 z175 │        └───────┘                    │
 z176 ├════════════ door ══════════════════─┤  ← divider wall
 z177 │                                      │  MIDDLE HALL (z177–185)
      │      big open hall — APARTMENTS      │  x1669–1700, floor Y34, ceil Y44
 z185 │                                 [H]→ │  ladder up at x1702,z181
 z186 ├════════════ door ══════════════════─┤  ← divider wall
 z187 │  · · · pillared hall · · ·           │  SOUTH BAND (z187–199)
 z199 └────────────────────────────────────┘  pillar row at z189, east wall ~x1699
```

## Rooms

| Room | Bounds (interior) | Floor Y | Status |
|------|-------------------|---------|--------|
| North band | x1669–1690 / z156–175 | 34 | **BUILT — 4 apartments (N1–N4) + clear spine corridor + north room kept open** |
| **Middle hall → APARTMENTS** | x1669–1700 / z177–185 | 34 | **BUILT — 4 apartments + corridor + utility** |
| South pillared hall | x1669–1699 / z187–199 | 34 | existing, untouched |

## Apartment build plan (middle hall)

Subdivide the 32×9 hall into **4 compact apartments** along the north, a **3-wide
corridor** along the south (against the z186 wall), and an **east vestibule** at the
ladder. Drop the apartment/corridor ceiling to **Y40** (5-tall, cozy) — the space
above stays capped.

- Unit dividers (`stone_bricks`, z177–182, Y35–39) at **x1676, 1683, 1690, 1698**
- Apartments: **APT1** x1669–1675, **APT2** x1676–1682, **APT3** x1683–1689,
  **APT4** x1690–1697; **vestibule** x1698–1700 (open to ladder)
- Corridor: **z183–185**; apartment/corridor wall at **z182** with a door per unit
  (x1672 / x1679 / x1686 / x1693)
- Dropped ceiling: `gray_concrete` at **Y40** over x1669–1700 / z177–185
- Each apartment: bed + chest + crafting table + hanging lantern; shared
  furnace/storage in the corridor's east end.

## Rail connection

The **existing east ladder at (1702, z181)** climbs Y35→Y51, landing at the town
rail-corridor level right by the hub (1700,51,180) — so it *is* the bunker's rail
spur. Wayfinding: `oak_wall_sign` "^ RAIL HUB" at the ladder base (1700,36,180),
standing `oak_sign` "v BUNKER" at the top (1699,52,182). The town rail network now
has people-mover walkways (see `docs/RAILWAY.md`), so you can climb up and ride.

## Build log

- 2026-07-01 — mapped + verified shell; apartment plan drafted.
- 2026-07-01 — **built the middle hall out:** 4 apartments (dividers at x1676/1683/
  1690/1698, oak-plank floors, `oak_door`s at x1672/1679/1686/1693, dropped
  `gray_concrete` ceiling at Y40 for a cozy 5-tall feel), each furnished with a bed
  (red/blue/lime/yellow) + chest + crafting table + hanging lantern; south corridor
  (z183–185) with a utility bay (2 furnaces + blast furnace + chest + barrel);
  wall-sign labels APT 1–4 + a directory sign; rail-connection signs both ends.
  Verified block-by-block on APT3 (representative). Built by Eleven.
- 2026-07-01 — **built the north band out:** central spine corridor at **x1679–1681**
  kept fully clear and aligned to the z176 apartment doorway (so no bedroom blocks an
  entrance), with **4 apartments N1–N4** flanking it (dividers, `oak_door`s at z166/
  z172, dropped Y40 ceiling, oak floors, beds/chests/crafting, lanterns, APT N1–N4
  signs). Punched a doorway through the existing spruce structure at z160–166 so the
  **north room (z156–159) stays reachable** — verified the corridor is clear end to
  end (z156→z176). Built by Eleven.
- _Untouched:_ south pillared hall (z187–199) — existing player build. Next candidate.
