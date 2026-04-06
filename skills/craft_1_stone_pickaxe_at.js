async function craftStonePickaxeAtTable(bot) {
  const sticks = bot.inventory.items().find(i => i.name === 'stick');
  if (!sticks || sticks.count < 2) {
    let planks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
    if (!planks) {
      const log = bot.inventory.items().find(i => i.name.endsWith('_log'));
      if (!log) {
        await mineBlock('oak_log', 1);
      }
      const logToCraft = bot.inventory.items().find(i => i.name.endsWith('_log'));
      const plankName = logToCraft.name.replace('_log', '_planks');
      await craftItem(plankName, 1);
      planks = bot.inventory.items().find(i => i.name === plankName);
    }
    await craftItem('stick', 1);
  }
  const cobblestone = bot.inventory.items().find(i => i.name === 'cobblestone');
  if (!cobblestone || cobblestone.count < 3) {
    await mineBlock('stone', 3);
  }
  await moveTo(947, 69, 362, 3);
  await craftItem('stone_pickaxe', 1);
}