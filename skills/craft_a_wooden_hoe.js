async function craftAWoodenHoe(bot) {
  const existingHoe = bot.inventory.items().find(i => i.name === 'wooden_hoe');
  if (existingHoe) return;

  // 1. Collect Wood (Need at least 2 logs for: 2 planks for hoe, 2 sticks, 4 planks for crafting table)
  let logs = bot.inventory.items().find(i => i.name.endsWith('_log'));
  if (!logs) {
    const logTypes = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'cherry_log', 'mangrove_log'];
    let foundLog = false;
    for (const logType of logTypes) {
      try {
        await mineBlock(logType, 3);
        foundLog = true;
        break;
      } catch (e) {
        continue;
      }
    }
    if (!foundLog) {
      await exploreUntil('north', 60, () => bot.findBlock({
        matching: b => b.name.endsWith('_log'),
        maxDistance: 32
      }));
      const nearbyLog = bot.findBlock({
        matching: b => b.name.endsWith('_log'),
        maxDistance: 32
      });
      if (nearbyLog) {
        await mineBlock(nearbyLog.name, 3);
      }
    }
    logs = bot.inventory.items().find(i => i.name.endsWith('_log'));
  }
  if (!logs) throw new Error("Could not find any logs to craft a hoe.");

  // 2. Craft Planks
  const plankName = logs.name.replace('_log', '_planks');
  let planks = bot.inventory.items().find(i => i.name === plankName);
  if (!planks || planks.count < 8) {
    await craftItem(plankName, 3);
    planks = bot.inventory.items().find(i => i.name === plankName);
  }

  // 3. Craft Sticks
  let sticks = bot.inventory.items().find(i => i.name === 'stick');
  if (!sticks || sticks.count < 2) {
    await craftItem('stick', 1);
    sticks = bot.inventory.items().find(i => i.name === 'stick');
  }

  // 4. Ensure Crafting Table
  let tableBlock = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!tableBlock) {
    let tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (!tableItem) {
      await craftItem('crafting_table', 1);
      tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
    }
    // Place the table near the bot
    const pos = bot.entity.position.floored().offset(1, 0, 0);
    await placeItem('crafting_table', pos.x, pos.y, pos.z);
    tableBlock = bot.findBlock({
      matching: b => b.name === 'crafting_table',
      maxDistance: 32
    });
  }

  // 5. Craft the Wooden Hoe
  if (tableBlock) {
    await moveTo(tableBlock.position.x, tableBlock.position.y, tableBlock.position.z, 3, 10);
    await craftItem('wooden_hoe', 1);
  } else {
    throw new Error("Could not find or place a crafting table.");
  }
}