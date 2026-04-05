async function craftLightningRod(bot) {
  const getCount = name => bot.inventory.items().find(i => i.name === name)?.count || 0;
  let currentIngots = getCount('copper_ingot');
  if (currentIngots < 3) {
    let currentRaw = getCount('raw_copper');
    let neededRaw = 3 - currentIngots;
    if (currentRaw < neededRaw) {
      const copperOre = bot.findBlock({
        matching: b => b.name === 'copper_ore' || b.name === 'deepslate_copper_ore',
        maxDistance: 32
      });
      if (!copperOre) {
        await exploreUntil('north', 60, () => bot.findBlock({
          matching: b => b.name === 'copper_ore' || b.name === 'deepslate_copper_ore',
          maxDistance: 32
        }));
      }
      await mineBlock('copper_ore', neededRaw - currentRaw);
    }
    await smeltItem('raw_copper', 'coal', 3 - currentIngots);
  }
  if (!bot.inventory.items().find(i => i.name === 'crafting_table')) {
    if (getCount('spruce_planks') < 4) {
      if (getCount('spruce_log') === 0) {
        await mineBlock('spruce_log', 1);
      }
      await craftItem('spruce_planks', 1);
    }
    await craftItem('crafting_table', 1);
  }
  await craftItem('lightning_rod', 1);
}