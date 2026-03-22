async function craftOneCraftingTable(bot) {
  const existingTable = bot.inventory.items().find(i => i.name === 'crafting_table');
  if (existingTable) return;
  const planks = bot.inventory.items().filter(i => i.name.endsWith('_planks'));
  const plankCount = planks.reduce((acc, i) => acc + i.count, 0);
  if (plankCount < 4) {
    const oakLog = bot.inventory.items().find(i => i.name === 'oak_log');
    const spruceLog = bot.inventory.items().find(i => i.name === 'spruce_log');
    if (oakLog) {
      await craftItem('oak_planks', 1);
    } else if (spruceLog) {
      await craftItem('spruce_planks', 1);
    } else {
      await mineBlock('oak_log', 1);
      await craftItem('oak_planks', 1);
    }
  }
  await craftItem('crafting_table', 1);
  const finalTable = bot.inventory.items().find(i => i.name === 'crafting_table');
  if (!finalTable) {
    throw new Error('Crafting table was not found in inventory after crafting attempt.');
  }
}