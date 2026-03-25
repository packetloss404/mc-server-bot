async function placeTableAndCraftStonePickaxe(bot) {
  let craftingTableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
  if (!craftingTableItem) {
    const oakPlanks = bot.inventory.items().find(i => i.name === 'oak_planks');
    const birchPlanks = bot.inventory.items().find(i => i.name === 'birch_planks');
    const sprucePlanks = bot.inventory.items().find(i => i.name === 'spruce_planks');
    if (!(oakPlanks && oakPlanks.count >= 4) && !(birchPlanks && birchPlanks.count >= 4) && !(sprucePlanks && sprucePlanks.count >= 4)) {
      await mineBlock('oak_log', 1);
      await craftItem('oak_planks', 1);
    }
    await craftItem('crafting_table', 1);
    craftingTableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
  }
  let tableBlock = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!tableBlock) {
    const referenceBlock = bot.findBlock({
      matching: b => ['grass_block', 'dirt', 'stone', 'cobblestone', 'andesite'].includes(b.name),
      maxDistance: 32
    });
    if (referenceBlock) {
      const pos = referenceBlock.position.offset(0, 1, 0);
      await placeItem('crafting_table', pos.x, pos.y, pos.z);
      tableBlock = bot.findBlock({
        matching: b => b.name === 'crafting_table',
        maxDistance: 32
      });
    }
  }
  if (tableBlock) {
    await moveTo(tableBlock.position.x, tableBlock.position.y, tableBlock.position.z, 3, 10);
    await craftItem('stone_pickaxe', 1);
  }
}