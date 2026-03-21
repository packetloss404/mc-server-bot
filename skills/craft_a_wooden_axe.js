async function craftWoodenAxe(bot) {
  const existingAxe = bot.inventory.items().find(i => i.name === 'wooden_axe');
  if (existingAxe) return;

  // 1. Make space in inventory by tossing some seeds
  const seeds = bot.inventory.items().find(i => i.name === 'wheat_seeds');
  if (seeds) {
    await bot.toss(seeds.type, null, seeds.count);
  }

  // 2. Ensure we have enough logs (need at least 2 logs for table + axe)
  // We already have 1 spruce_log and 2 spruce_planks.
  // 1 log = 4 planks. 2 planks + 4 planks = 6 planks.
  // Crafting table = 4 planks. Axe = 3 planks. Total 7 planks needed.
  // We need 1 more log.
  const logBlock = bot.findBlock({
    matching: b => b.name.endsWith('_log'),
    maxDistance: 32
  });
  if (!logBlock) {
    await exploreUntil('north', 60, () => bot.findBlock({
      matching: b => b.name.endsWith('_log'),
      maxDistance: 32
    }));
  }
  const logToMine = bot.findBlock({
    matching: b => b.name.endsWith('_log'),
    maxDistance: 32
  });
  if (logToMine) {
    await mineBlock(logToMine.name, 1);
  }

  // 3. Craft planks from all logs
  const logs = bot.inventory.items().filter(i => i.name.endsWith('_log'));
  for (const log of logs) {
    const plankName = log.name.replace('_log', '_planks');
    await craftItem(plankName, log.count);
  }

  // 4. Ensure we have a crafting table
  let tableBlock = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!tableBlock) {
    let tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (!tableItem) {
      const anyPlanks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
      if (anyPlanks && anyPlanks.count >= 4) {
        await craftItem('crafting_table', 1);
      } else {
        // If not enough planks, get one more log
        await mineBlock(logToMine ? logToMine.name : 'oak_log', 1);
        const newLog = bot.inventory.items().find(i => i.name.endsWith('_log'));
        await craftItem(newLog.name.replace('_log', '_planks'), 1);
        await craftItem('crafting_table', 1);
      }
      tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
    }

    // Place the crafting table
    const referenceBlock = bot.findBlock({
      matching: b => b.name !== 'air' && b.name !== 'water' && b.name !== 'lava' && b.boundingBox === 'block',
      maxDistance: 4
    });
    const pos = referenceBlock ? referenceBlock.position.offset(0, 1, 0) : bot.entity.position.offset(1, 0, 0).floored();
    await placeItem('crafting_table', pos.x, pos.y, pos.z);
    tableBlock = bot.findBlock({
      matching: b => b.name === 'crafting_table',
      maxDistance: 32
    });
  }

  // 5. Ensure we have sticks (need 2)
  const sticks = bot.inventory.items().find(i => i.name === 'stick');
  if (!sticks || sticks.count < 2) {
    const planks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
    await craftItem('stick', 1);
  }

  // 6. Craft the wooden axe
  await craftItem('wooden_axe', 1);
}