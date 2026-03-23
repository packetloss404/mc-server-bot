# Barley Log Audit — 2026-03-22

## Session Overview

| Field | Value |
|---|---|
| Bot | Barley (farmer, codegen mode) |
| LLM | gemini-3.1-pro-preview |
| Server started | 00:09:48 |
| Log file | /tmp/dyobot.log (252k lines) |
| Current state | IDLE at (1744, 35, 437) — underground |
| Deaths | 0 |
| Damage taken | 23 |
| Movement timeouts | 6 |

---

## Task Pipeline Summary

| Metric | Count |
|---|---|
| Tasks proposed | 66 |
| Tasks completed (lifetime) | 47 |
| Tasks failed (lifetime) | 39 |
| Tasks failed after max retries (this session) | 42 |
| Skills saved to library | 27 |
| Gemini MAX_TOKENS truncations | **139** |
| Curriculum infeasible fallbacks | 9 |

**Success rate this session is poor.** Most recent task cycle (19:01–19:19) shows 8 task proposals, heavy retry churn, and only 2 new skills saved (`craft_a_stone_pickaxe`, `go_back_to_the_surface`).

---

## Top Errors

| Count | Error Type |
|---|---|
| 46 | `moveTo` timed out |
| 41 | `exploreUntil` timed out |
| 37 | Generic `execution_error` |
| 10 | Full execution timed out |
| 139 | Gemini response truncated (MAX_TOKENS) |

The `Chunk size is 21 but only 20 was read` warnings are benign Mineflayer protocol noise — not a real issue.

---

## Recurring Critic Feedback (Failure Patterns)

### 1. Crafting failures
- **stone_pickaxe**: Failed multiple times before eventually succeeding. Critic repeatedly said "Check whether stone_pickaxe is already in inventory. Collect prerequisite materials before crafting."
- **iron_hoe**: Failed — couldn't gather iron ingots + craft it despite having raw iron and a furnace.

### 2. Mining failures (iron_ore, oak_log)
- Bot navigates toward target but `moveTo` times out (30s limit hit repeatedly).
- Then `mineBlock` runs at the **old position** (not the target), so it mines whatever is nearby — doesn't collect the expected item.
- Critic: "The bot did not collect the expected item. Use mineBlock(...) and verify the exact target block/item name."

### 3. Invalid API calls in generated code
- `bot.activateBlock is not a function` — Gemini generated code using Mineflayer's raw API instead of the primitive wrappers.
- `bot.setControlState is not a function` — Same issue. The bot sandbox doesn't expose these.
- These cause immediate execution errors and burn retry cycles.

### 4. Farming hasn't started
Despite being a **farmer** personality:
- Has wheat_seeds x10 in inventory
- Has a wooden_hoe
- Attempted to till dirt blocks but failed (wrong API usage)
- No wheat has been planted
- No farmland has been created

### 5. Pathfinding thrashing
The most recent logs show constant `goal_updated` → `path_reset` cycles every ~1 second. The bot appears stuck in a small area near (1743, 35-36, 436-437), oscillating between goals. This is likely an underground cave where it can't path to the target.

---

## Barley's Current Inventory

```
netherite_helmet x1     wheat_seeds x10
cooked_beef x2          coal x17
glowstone_dust x9       torches x13
sticks x8               gravel x13
flint x3                cobblestone x117
stone_sword x1          stone_pickaxe x2
wooden_axe x1           wooden_pickaxe x1
wooden_hoe x1           iron_ingot x2
furnace x1              spruce_planks x4
spruce_log x2           andesite x4
kelp x2                 oak_sapling x1
spruce_sapling x2       sandstone x2
sand x2                 feather x1
```

---

## World Memory

Barley has mapped **90+ resource locations** across a huge area:
- From ~(833, 260) to ~(1807, 468)
- Resources: iron_ore, coal_ore, water, oak_log
- Found 3 chests (one with 44 cooked_beef)
- Placed 7 crafting_tables and 3 furnaces

---

## Gemini Token Truncation (Critical Issue)

**139 truncations** means Gemini's responses are being cut off before completion. This wastes API calls and causes:
- Incomplete code generation → execution errors
- Incomplete curriculum proposals → infeasible tasks
- Wasted retry cycles

The most recent cluster (19:18:36–19:18:46) had 3 truncations in 10 seconds, right before a new task proposal.

---

## Recommendations

1. **Reduce prompt size or increase max_tokens** — 139 truncations is the #1 issue. The prompts (which include inventory, world memory, skill library, etc.) may be too large.

2. **Fix moveTo timeout → mineBlock at wrong position** — When moveTo times out, the bot should NOT proceed to mine. It should either retry navigation or skip the task. Currently it mines at whatever position it ended up at.

3. **Add API guardrails** — The generated code calls `bot.activateBlock` and `bot.setControlState` which don't exist in the sandbox. Either expose these or add them to the negative prompt so Gemini avoids them.

4. **Surface the bot** — Barley is stuck at Y=35 underground. The `go_back_to_the_surface` task was just learned but the bot went right back to mining iron. As a farmer, it should be above ground.

5. **Prioritize farming tasks** — The curriculum agent keeps proposing mining/crafting tasks instead of farming. The farmer personality should bias toward: till soil → plant seeds → tend crops.

6. **Pathfinder thrashing** — The constant goal_updated resets suggest either the task is changing too frequently or the pathfinder can't find a valid path. Consider adding a cooldown between goal changes.

---

## Generated Code Samples (Recent)

### craft_a_stone_pickaxe (succeeded after retries)
```js
async function craftStonePickaxeTask(bot) {
  let tableBlock = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!tableBlock) {
    let tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (!tableItem) {
      let planks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
      if (!planks || planks.count < 4) {
        let logs = bot.inventory.items().find(i => i.name.endsWith('_log'));
        if (logs) {
          await craftItem(logs.name.replace('_log', '_planks'), 1);
        } else {
          await mineBlock('oak_log', 1);
          await craftItem('oak_planks', 1);
        }
      }
      await craftItem('crafting_table', 1);
    }
    const referenceBlock = bot.findBlock({
      matching: b => b.name !== 'air' && b.name !== 'water' && b.name !== 'lava' && b.boundingBox === 'block',
      maxDistance: 4
    });
    const pos = referenceBlock
      ? referenceBlock.position.offset(0, 1, 0)
      : bot.entity.position.offset(1, 0, 0).floored();
    await placeItem('crafting_table', pos.x, pos.y, pos.z);
    tableBlock = bot.findBlock({
      matching: b => b.name === 'crafting_table',
      maxDistance: 32
    });
  }
  if (tableBlock) {
    const dist = bot.entity.position.distanceTo(tableBlock.position);
    if (dist > 3) {
      await moveTo(tableBlock.position.x, tableBlock.position.y, tableBlock.position.z, 2, 10);
    }
  }
  let sticks = bot.inventory.items().find(i => i.name === 'stick');
  if (!sticks || sticks.count < 2) {
    await craftItem('stick', 1);
  }
  let cobblestone = bot.inventory.items().find(i => i.name === 'cobblestone');
  let cobbleCount = cobblestone ? cobblestone.count : 0;
  if (cobbleCount < 3) {
    await mineBlock('stone', 3 - cobbleCount);
  }
  await craftItem('stone_pickaxe', 1);
}
```

### mine_1_iron_ore (failed — moveTo timeout)
```js
async function mineOneIronOreAtTarget(bot) {
  await moveTo(1735, 35, 441, 3, 30);
  await mineBlock('iron_ore', 1);
}
```
Critique: "The bot did not collect the expected item (iron_ore). Use mineBlock(...) and verify the exact target block/item name."

The moveTo timed out at 30s, bot stayed at (1743, 36, 437), then mineBlock ran at the wrong position.
