# Autonomous Town Builder — Spec

The definitive design document for the `/town` dashboard feature. Captures
every decision from the design conversation that produced it. Anything not
specified here is at implementer discretion.

## 1. Vision

A dashboard tab where the player designates a region, optionally tweaks a
few sliders, and walks away. Bots autonomously plan, gather, build, defend,
expand, and chronicle a self-sustaining town. The player is the Mayor — a
real Minecraft account that bots greet, occasionally consult, and obey when
they speak up. A separate (out-of-repo) streaming platform will consume the
town's event stream and chronicle to broadcast highlights to YouTube.

Tagline: *set it, tweak it, walk away — and watch it on stream.*

## 2. Core decisions

| Decision | Choice |
|---|---|
| Multi-town | Supported from day one. AI decides when to seed a second town. |
| Autonomy default | Fully autonomous. Player overrides via dashboard, not by default approval. |
| Defense | Always fight back. Emergency role-swap during raids. |
| Aesthetic | Emergent — town learns its own style from successful builds. |
| Style seed | Choose at town founding from one of two presets (more can be added later). |
| Style preset A | **Medieval communal** — village/town with strong social architecture: tavern, market square, guildhall, town well, blacksmith, bakery, watchtowers. Witcher-3-small-village vibe. Cobblestone + oak + dark_oak palette. Steep roofs, half-timbered facades. |
| Style preset B | **Mid-50s / early-60s American civic** — big government buildings, square town blocks, town square with town hall or courthouse in the middle. Smooth_stone + concrete palette. Flat roofs, columned civic entries. |
| Schematic strategy | LLM-first design with caching. Existing 6 schematics + future paid packs as a fallback/seed pool. |
| Failure mode | Phoenix (self-heal). Disasters documented in a physical Memorial Park. |
| Player avatar | Mayor mode. Title configurable, default: `Mayor Lord Savior packetloss404`. |
| Scale | Start as Village. Auto-step-up to Town. Hard cap below "Chicago" — beyond cap, seed a new town. |
| Chronicle | Character-driven (C tier). Per-bot journals + town narrator. |
| Storage | **SQLite** via Drizzle ORM, schema Postgres-compatible. Future website queries the DB. |
| Inter-town | Independent at first, then **Allied with occasional rivalry**. |
| Streaming hook | WebSocket event channel — extends the existing Socket.IO bus. |
| Town founding | Requires explicit "Found Town" confirmation. No accidental towns. |
| Town death | 0 living bots → "dormant." 30-min auto-respawn from roster. Repeated failure → "abandoned" (player revives manually). |

## 3. Town tiers

| Tier | Bots | Buildings | Footprint | Triggers next tier |
|---|---|---|---|---|
| Founding | 1-3 | 0-2 | town center + plot reserve | Town Hall completed |
| **Village** (start) | 3-8 | 5-15 | ~4×4 chunks | Population ≥ 8 AND food surplus 3+ days |
| Town | 8-20 | 15-40 | ~8×8 chunks | Population ≥ 20 AND treasury surplus AND 2 districts |
| **HARD CAP** | 30 | 60 | ~10×10 chunks | Forces new-town seeding, never larger here |

Auto-expansion thresholds tunable from the `/town` settings panel.

## 4. Architecture — five layers

**Layer 0: Land + Layout**
- Player drops Town Center marker in `/town` tab, draws optional zone bounds.
- `SiteSelector` runs once at founding to assess buildable cells.
- Player clicks "Found Town" → town created in DB, `Town` object instantiated, bots assigned.

**Layer 1: Town Hall (NEW)**
- Per-town singleton holding: goals, treasury (aggregate stockpile value), role assignments, scheduled events, growth tier, style doc, alliance state.
- Ticks every ~60s.

**Layer 2: Town Brain (NEW)**
- Runs every Town Hall tick. Four sub-loops:
  - **Demand loop** — scan shared stockpile, flag deficiencies, auto-dispatch supply chains.
  - **Build loop** — scan town plan vs current state, queue campaigns for gaps.
  - **Role loop** — rebalance roles based on population × needs × current jobs.
  - **Threat loop** — aggregate hostile awareness from bots, broadcast raid alerts, trigger role-swap-to-guard if active.

**Layer 3: Reflection (NEW)**
- Every ~30 minutes, an "Elder" bot LLM-reflects on town state: what worked, what's slow, what to prioritize next. Updates Town Hall sliders. This is the Smallville pattern.
- Generates the daily chronicle entry by feeding the day's events to the LLM.

**Layer 4: Existing per-bot Voyager loop**
- Unchanged. Bots pull from blackboard, execute via existing primitives, report.
- Town Brain just seeds the blackboard better.

**Layer 5: Player oversight**
- `/town` dashboard tab. Live view of everything Town Hall sees.
- Big toggles: pause autonomy, manual override, adjust sliders.
- Approval queue for big-spend decisions (configurable threshold).

## 5. Schematic source pipeline

When the town needs a building:

```
1. Style consultation
   - Read town style doc (palette, common dims, roof types)

2. LLM design path (PRIMARY)
   - Prompt: request + style + plot dimensions + neighbors for context
   - LLM returns JSON block plan
   - Validate: no floating blocks, no terrain overlap, footprint fits

3. Cache successful designs
   - Save as named file in schematics/<town>/
   - Future "same request" re-uses cached design
   - Style observation: successful designs feed back into the style doc

4. Fallback to existing library
   - When LLM fails validation 3x, use SchematicMatcher to find closest
     match in the existing schematics/ directory (current behavior)

5. Single-schematic placement (unchanged)
   - User can still drop a single schematic via the existing flow
```

**Budget**: ~$10-12 per town in LLM design costs, settles after ~30-50
buildings cached. Chronicle adds ~$0.50/day per active town.

**Cost caps**: configurable per-town daily LLM spend ceiling. Hitting the
cap pauses LLM building (falls back to library) and posts a notification.

## 6. Style doc — emergent

A JSON file at `data/towns/<id>/style.json` representing the town's
inferred style. Schema:

```json
{
  "townId": "town_main",
  "lastObservedAt": 1775687000000,
  "block_palette": {
    "common": ["smooth_stone", "stone_bricks", "polished_andesite", "white_concrete"],
    "accent": ["dark_oak_planks", "iron_block"],
    "roof": ["smooth_stone_slab"],
    "floor": ["polished_andesite"]
  },
  "dimensions": {
    "house_avg": { "w": 9, "h": 6, "d": 11 },
    "civic_avg": { "w": 19, "h": 12, "d": 23 }
  },
  "patterns": {
    "roof_style": "flat",
    "wall_height_typical": 4,
    "windows": "tall_rectangular",
    "facade_features": ["columned_entry", "centered_door"]
  },
  "seed_style": "mid-century-american-civic"
}
```

**Initial seed** — chosen per town at founding:

- **Medieval communal** (default): cobblestone + oak + dark_oak palette,
  steep gabled roofs, half-timbered upper stories, small leaded windows.
  Civic centerpiece is the town square anchored by the town well, with
  the tavern and guildhall facing it. Walls of cobblestone or wood
  palisade. Watchtowers at the corners. Strong communal/social emphasis
  — buildings cluster around shared spaces rather than spread out.

- **Mid-Century civic**: smooth_stone + concrete palette, flat roofs,
  columned civic entries, white/grey/cream walls. Big government
  buildings (courthouses, post offices), square town blocks for
  residential, town square with the hall in the middle.

The first ~20 buildings of each town are constrained to its chosen
preset; from there the style doc evolves as buildings succeed. Both
presets are encoded as starter `style.json` templates the founding flow
chooses between.

**Districts: a town can hold multiple styles.** The founding style is
the town's first (and initially only) district. As the town reaches Town
tier, the Elder may propose "modernizing" — declaring a new district
within the town that uses a different preset. The medieval village
core stays medieval; the new downtown district is mid-century civic.

Implementation:
- Every town starts with one default district covering the whole
  buildable area, using the founding preset.
- New zones can be tagged as a district with a specific style preset.
- New buildings inherit the style of the district they're placed in.
- The Elder's reflection can propose "found a new district with style X"
  as a major decision (mayor approval required by default).
- Streaming gold: "Day 47: the elder council voted to commission a new
  civic district on the eastern edge of town, breaking from a century
  of medieval tradition."

The medieval → mid-century downtown arc is the canonical example. Both
preset styles can coexist within a single town once it crosses into the
Town tier.

**Anti-uglification**: dashboard has a "this building shouldn't count
toward style" thumbs-down. Building gets removed from the style sample
pool. Also a quality threshold during LLM-design validation — any
building below threshold is regenerated up to N times.

## 7. Memorial Park

A designated zone built shortly after town hall founding. Bots maintain
it. When a disaster strikes:

- A row inserted into `disasters` table
- A small monument placed in the park (tombstone for a dead bot, placard
  for a destroyed building, plaque for a survived raid)
- A chronicle entry tagged `disaster`
- A highlight event emitted (high score for the streamer)

The park grows over time. A walking tour gives the town's history. Bots
periodically visit (programmed into the Elder's role) and a "moment of
silence" is logged when a new tombstone is placed.

## 8. Mayor mode

When the player logs into Minecraft and approaches a bot:

- Bots greet by configured title (default: `Mayor Lord Savior packetloss404`)
- Bots within ~16 blocks pause non-critical tasks to acknowledge
- Right-clicking a bot opens a context-sensitive dialog (via chat for now): "Yes, Mayor? I'm currently building a house. Did you need something?"
- Mayor commands via chat override Town Brain: "build a watchtower here" → BuildIntentResolver routes through the existing path but tagged as `mayor_directive`, bumped to highest priority.
- Mayor can vote in town decisions when the Elder requests one (rare; for major decisions like founding a second town).
- A `/town` setting toggle: "Stealth Mode" — bots don't acknowledge or greet the player. Lets you spy on them undisturbed.

Configurable via `data/towns/<id>/mayor.json`:

```json
{
  "playerName": "packetloss404",
  "title": "Mayor Lord Savior",
  "stealth": false,
  "voteWeight": 1.0
}
```

## 9. Alliance state (deferred to Phase 5)

When the AI seeds a second town, both towns start with `alliance: null`.

Future Phase 5 wires in:
- **Allied** — residents may travel, resources may be shared via supply chains, both chronicles cross-reference.
- **Rival** — periodic friction events (border disputes, resource competition, sabotage attempts). Streaming gold.
- **Neutral** — coexist, ignore each other.

State transitions LLM-driven via Elder reflection. Player can override.

## 10. Database — SQLite via Drizzle

Single file: `data/town.db`. Drizzle ORM. Schema Postgres-compatible.

### Tables

```
towns (
  id text primary key,
  name text not null,
  founded_at integer not null,
  capital_x integer, capital_y integer, capital_z integer,
  tier text check (tier in ('founding','village','town')),
  status text check (status in ('active','dormant','abandoned')),
  population_target integer,
  alliance_state text,            -- 'allied' / 'rival' / 'neutral' / null
  parent_town_id text,            -- if seeded from another town
  style_seed text,
  config_json text                 -- mayor info, sliders, etc.
)

residents (
  id text primary key,
  town_id text references towns(id),
  bot_name text not null,
  joined_at integer not null,
  current_role text,
  status text,                     -- 'alive' / 'dead' / 'departed'
  unique (town_id, bot_name)
)

districts (
  id text primary key,
  town_id text references towns(id),
  name text,                       -- "Old Town", "Downtown"
  style_preset text not null,      -- 'medieval-communal' / 'mid-century-civic'
  bounds_json text,                -- polygon/AABB defining the district
  founded_at integer not null,
  is_default boolean default false -- the founding district
)

buildings (
  id text primary key,
  town_id text references towns(id),
  district_id text references districts(id),
  name text,                       -- "Town Hall", "House 3", "Memorial Park"
  schematic_source text,           -- 'llm' / 'library' / 'mayor_directive'
  schematic_ref text,              -- filename in schematics/, or DB cache key
  origin_x integer, origin_y integer, origin_z integer,
  width integer, height integer, depth integer,
  built_at integer,
  destroyed_at integer,
  status text                      -- 'planned' / 'building' / 'complete' / 'damaged' / 'destroyed'
)

events (
  id text primary key,
  town_id text references towns(id),
  kind text not null,              -- 'build_completed' / 'bot_died' / 'raid' / 'expansion' / etc.
  severity text,                   -- 'info' / 'minor' / 'major' / 'critical'
  payload_json text,
  occurred_at integer not null,
  highlight_score integer          -- 0-100; higher = more stream-worthy
)

chronicle_entries (
  id text primary key,
  town_id text references towns(id),
  day_number integer not null,
  kind text,                       -- 'daily' / 'milestone' / 'disaster' / 'voice'
  body text not null,
  generated_at integer,
  model text                       -- which LLM produced it
)

bot_journals (
  id text primary key,
  town_id text references towns(id),
  bot_name text not null,
  day_number integer,
  body text not null,
  generated_at integer
)

disasters (
  id text primary key,
  town_id text references towns(id),
  kind text,                       -- 'raid' / 'lava' / 'lost_bot' / 'crash'
  severity text,
  occurred_at integer,
  memorial_marker_id text,         -- references markers.json (the park monument)
  summary text
)

style_observations (
  id text primary key,
  town_id text references towns(id),
  building_id text references buildings(id),
  palette_json text,
  recorded_at integer,
  included boolean default true    -- false if mayor thumbed-down
)
```

### Indexes
- `events(town_id, occurred_at DESC)` — hot path for dashboards
- `events(town_id, highlight_score DESC, occurred_at DESC)` — streamer query
- `buildings(town_id, status)` — town plan rendering
- `chronicle_entries(town_id, day_number DESC)`

### Fallback if DB connection fails
The Town Brain wraps DB writes in a try-catch. On failure, events fall
back to JSONL append-only files at `data/towns/<id>/events.jsonl`. A
boot-time check imports any pending JSONL events into the DB once it
becomes available. Town keeps running.

## 11. Event channel — WebSocket

Extends the existing Socket.IO bus. New event names:

```
town:event           -> { townId, kind, severity, payload, ts, highlightScore }
town:chronicle       -> { townId, dayNumber, entry }
town:state           -> { townId, tier, pop, treasury, currentGoal }
town:tier-up         -> { townId, fromTier, toTier }
town:alliance        -> { townId, otherTownId, state }
town:mayor-greeting  -> { townId, botName, message }    // for streamer audio
town:disaster        -> { townId, kind, severity, summary }
```

The streaming app subscribes via `socket.on('town:*', ...)` after authenticating with the existing `DASHBOARD_AUTH_SECRET`.

Highlight scoring heuristic (initial):
- `bot_died`: 80
- `raid_survived`: 90
- `raid_lost_building`: 95
- `tier_up`: 85
- `first_building_of_kind`: 70 (first house, first farm, first wall, etc.)
- `expansion_seeded`: 100 (new town founded)
- `mayor_visit`: 60
- `chronicle_published` (daily): 30
- routine `build_completed`: 20 (a new house is only mildly notable after the 5th)
- `style_evolution`: 40 (when the style doc updates significantly)

Tunable in config.

## 12. Dashboard `/town` tab

Top strip — **Town picker** dropdown if multiple towns exist + status pill (tier / pop / treasury / current goal).

Layout:

- **Left**: map (reusing existing map page component) with town overlays — zones, buildings, planned-builds as ghosts, bot positions, the Memorial Park footprint.
- **Center**: town plan timeline. Vertical list of buildings in queue. Drag-reorder. Click to inspect. "Override: add structure" button.
- **Right**: sliders + decisions.
  - Growth pace (stalled ↔ aggressive)
  - Defense weight (minimal ↔ paranoid)
  - Aesthetic strictness (free ↔ strict to style doc)
  - Auto-expansion (never / when surplus / aggressive)
  - LLM design budget ($/day cap)
  - Player approval needed for: nothing / big spend / any structure / all
- **Bottom**: activity stream — filterable event feed. Click "Highlights only" to see what's stream-worthy.

Big buttons:
- "Pause town" (freezes Town Brain; bots still survive but don't proactively act)
- "Manual override task" (insert a one-off task that bypasses Town Brain)
- "Memorial Park" — jumps map to the park
- "Found new town" (only enabled if Elder has proposed it)

## 13. Phased rollout

| Phase | Scope | ~Time |
|---|---|---|
| 1 | DB + Town model + `/town` tab + founding flow. No autonomy yet. | 1 week |
| 2 | Town Brain MVP: demand + build loops. Seeded with the Mid-Century style. | 1 week |
| 3 | Roles + day/night schedules + idle bot pickup. | 1 week |
| 4 | LLM-design pipeline + cache + style doc + chronicle (character-driven) | 2 weeks |
| 5 | Self-expansion + Memorial Park + Phoenix recovery + district system (medieval→mid-century arc) | 1.5 weeks |
| 6 | Mayor mode + greetings + town vote primitive | 1 week |
| 7 | Multi-town + alliance state machine | 1 week |
| 8 | Polish: streaming event tuning, highlight scoring, dashboard refinement | 1 week |

**Total: ~9 weeks**. Phase 1 alone gives you a usable town designator + queue. Phases 2-4 are when it starts feeling alive. Phases 5-7 are where it gets streamable.

Branch: `feature/town-builder` so it stays isolated from main dashboard work.

## 14. Open follow-ups (not blocking)

- **Schematic packs for purchase**: see `BUYWITHMONEY.md`. Reality: paid Mid-Century Civic packs barely exist; LLM design path is realistically the primary source. Free / one-off PlanetMinecraft finds can still seed the early library.
- **Bot personality drift**: as bots reflect, their personality may evolve. Do we want that? (Defer; revisit at Phase 4.)
- **Player voting weight**: Mayor vote weight is configurable per-town. Default 1.0; could allow >1 for "executive override." (Defer; revisit at Phase 6.)
- **Town treasury currency**: today it'd be aggregate inventory value. Future could mint a virtual currency (emeralds?) for narrative purposes. (Defer.)
- **Inter-town trade once allied**: routes between towns, caravans, shared stockpile zones. (Phase 7.)

## 15. Costs at steady state

Per active town, per day:

| Item | Cost |
|---|---|
| LLM building design (early growth) | $0.50-1.00 |
| LLM building design (mature, mostly cached) | $0.05-0.10 |
| Chronicle (character-driven, ~5 journals + 1 daily) | $0.30-0.50 |
| Reflection ticks | $0.10 |
| **Total at maturity** | **~$0.50-0.75 / town / day** |

A 3-town federation at maturity: ~$1.50-2.25/day = ~$45-70/month. With
cost caps + caching, this stays predictable.

## 16. Risks tracked

| Risk | Mitigation |
|---|---|
| LLM cost runaway | Per-town daily cap; falls back to library |
| Aesthetic drift to ugliness | Style seed + quality validator + thumbs-down + reset-style button |
| Bot death cascade | Phoenix respawn from roster + Memorial Park acknowledgment |
| DB corruption | JSONL fallback; atomic writes; full backup endpoint extended |
| Stream channel auth bypass | Reuses `DASHBOARD_AUTH_SECRET`; Socket.IO middleware enforces |
| Multi-town file path drift | All paths go through `townId` from day one |
| Schematic format compat | Validate `.schem` v2 on placement; reject unsupported variants |

## 17. Out of scope

- The streaming platform itself (separate repo).
- Vanilla Minecraft mod-side changes (e.g., custom blocks).
- Multiplayer human residents (we treat the Mayor as the only human resident).
- Pre-2024 chronicle entries (we start chronicling at town founding).
- Inter-server town federation (one server = one town federation).

---

End of spec.
