# Schematic Pack Shopping List

Curated options for buying / acquiring schematic packs to seed the town
builder's library, ordered cheapest → most expensive. The town supports
two style presets that the player picks at founding:

- **Medieval communal** — village/town with social architecture (tavern,
  market, guildhall, well, blacksmith). Easy to source; the Minecraft
  community has built a massive medieval schematic ecosystem.
- **Mid-Century civic** — 1950s-60s American civic. *Significantly*
  harder to source via paid packs; LLM design path is the realistic
  primary source. A few free finds noted below.

All files must be `.schem` or `.schematic` (the formats our
`BuildCoordinator` parses via `prismarine-schematic`).

---

## Medieval communal — best value path

### Tier 1 — Free first

**PlanetMinecraft schematic search** (https://www.planetminecraft.com/projects/?platform=1&share=schematic)
- Search terms: "medieval village house," "medieval tavern," "medieval
  market," "guildhall," "well," "blacksmith shop," "watchtower"
- Quality: mixed, but the medieval section is large. Expect to grab
  10-20 buildings that fit.
- License: per-creator. Most allow personal use.

**Builders Refuge community downloads** (https://buildersrefuge.com)
- Discord-gated. Search the pinned schematics channels.
- Quality: high (competition-level builds).
- Best for showpieces (large guildhalls, ornate taverns).

**WorldOfKeralis** (https://www.youtube.com/@WorldofKeralis) and similar
realistic-build YouTubers often release schematics in their video
descriptions or on Patreon. Some are free.

### Tier 2 — Patreon ($5-10/mo, ongoing pack drops)

**Stevler** (https://www.patreon.com/Stevler) — **strongest recommendation**
- ~$5/mo lowest tier usually includes downloads.
- Style: medieval fantasy, very high quality, coherent style.
- Why it fits: this is exactly the medieval communal aesthetic we want.
  Houses, taverns, guildhalls, walls — all available.
- **This is the single best value for a medieval town pack.**

**Linard** (https://www.patreon.com/linard)
- ~$5-10/mo.
- Style: organic, fantasy, very ornate.
- Notes: gorgeous but ornate side — better for Town tier showpieces than
  Village tier basics.

### Tier 3 — One-time purchases

**MrXVII Marketplace** (https://www.mrxvii.net) / **Builders Bay** (https://buildersbay.net)
- $5-25/pack.
- Look for "medieval village pack" or "medieval starter pack."
- Pre-curated, vanilla-compatible.

### Tier 4 — Free showpieces

**Reddit r/Minecraftbuilds** and **r/litematica**
- Frequent drops of community medieval builds with download links.

---

## Mid-Century civic — sparse paid market, LLM-first realistic

Paid packs barely exist in this style. The Minecraft community is 90%
medieval/fantasy. Realistic 1950s-60s civic Americana is niche.

### Free / one-off finds

**PlanetMinecraft search terms that sometimes work:**
- "1950s house"
- "ranch house"
- "courthouse"
- "town hall flat roof"
- "post office vintage"
- "diner 1950s"

Expect maybe 5-10 usable buildings from a full search. Style won't be
perfectly consistent.

**WorldOfKeralis** builds modern/realistic cities. Their YouTube and
Patreon ($5/mo) include period-correct American buildings, but not
focused on mid-century specifically.

### Recommendation for Mid-Century towns

Rely on the **LLM design path** as the primary schematic source. Seed
the library with 3-5 free PlanetMinecraft finds for style anchors. The
LLM will design the rest, constrained by the seeded examples. Budget
holds at ~$10-12/town since the style is straightforward to describe
(big stone civic buildings, flat roofs, columned entries).

---

## Recommended budget by style

### Medieval town

| Budget | Recommendation |
|--------|----------------|
| **$0** | 10-15 PlanetMinecraft finds + Builders Refuge Discord. Run for a week, see what works. |
| **$5/mo** | Subscribe to **Stevler's Patreon** at lowest tier. Single best ROI. |
| **$20 one-time** | Stevler ($5 first month) + a Builders Bay medieval village pack ($15). 30-50 buildings, coherent. |
| **$50-100** | Add Linard for showpieces + a Varuna landscape pack. Full aesthetic library. |

### Mid-Century town

| Budget | Recommendation |
|--------|----------------|
| **$0** | 3-5 PlanetMinecraft finds as style anchors. LLM designs the rest. |
| **$5/mo** | WorldOfKeralis Patreon — period-correct realism, broader scope. |
| **$20-50** | One-off purchase of a "modern realistic" pack. Mileage varies; verify in screenshots before paying. |

For a Mid-Century town, the LLM-design path *is* the budget. Trying to
buy your way to a coherent pack is largely fruitless.

---

## Compatibility notes

- We accept `.schem` (Sponge schematic v2, modern format) and the legacy
  `.schematic` (pre-1.13). Most packs ship `.schem` today.
- **Avoid** WorldEdit Pro-only formats unless you can convert them.
- **Avoid** Conquest Reforged packs — they reference custom blocks we
  don't have in vanilla.
- Test one schematic before bulk-importing: drop into `schematics/`,
  refresh the dashboard, try a build.

---

## Files in the project today (for reference)

The repo already ships these in `schematics/`:
- birch_house.schem
- Cute house.schem
- Space Mountain.schem
- md castle 2.schem
- Pokémon Temple.schem
- victorian palace.schem

These cover a range of styles — they coexist as fallbacks but the
chosen town preset takes priority.

Plus ~250 auto-generated skill files under `skills/` from the Voyager
loop. Those are programmatic, not schematics — they stay in place.

---

## What we'll do with whatever you buy

1. Drop the `.schem` files into `schematics/` (subfolder per style is
   fine: `schematics/medieval/`, `schematics/midcentury/`).
2. The dashboard's schematic search and the LLM-design pathway both
   consider every file in the dir.
3. The **emergent style doc** observes which schematics get used
   successfully in each town and biases the LLM's design prompts toward
   that style. Buying a coherent pack accelerates style emergence
   dramatically.

---

## Top picks (tl;dr)

- **Buy this first**: Stevler's Patreon, $5 for the first month. Cancel
  whenever. Gives you a solid medieval library immediately.
- **Free fallback**: PlanetMinecraft + Builders Refuge Discord, ~1 hour
  of curation work.
- **For Mid-Century towns**: don't buy anything. The LLM-design path is
  the real answer.
