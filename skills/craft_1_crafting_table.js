async function craftOneCraftingTable(bot) {
  const existingTable = bot.inventory.items().find(i => i.name === 'crafting_table');
  if (existingTable) return;
  let planks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
  if (!planks || planks.count < 4) {
    let logs = bot.inventory.items().find(i => i.name.endsWith('_log'));
    if (!logs) {
      await exploreUntil('north', 60, () => bot.findBlock({
        matching: b => b.name.endsWith('_log'),
        maxDistance: 32
      }));
      const logBlock = bot.findBlock({
        matching: b => b.name.endsWith('_log'),
        maxDistance: 32
      });
      if (logBlock) {
        await mineBlock(logBlock.name, 1);
      }
      logs = bot.inventory.items().find(i => i.name.endsWith('_log'));
    }
    if (logs) {
      const plankType = logs.name.replace('_log', '_planks');
      await craftItem(plankType, 1);
    }
  }
  await craftItem('crafting_table', 1);
}