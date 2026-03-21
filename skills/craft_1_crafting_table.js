async function craftOneCraftingTable(bot) {
  const existingTable = bot.inventory.items().find(i => i.name === 'crafting_table');
  if (existingTable) return;

  // Inventory is full (36/36), make space for logs and planks
  if (bot.inventory.items().length >= 36) {
    const seeds = bot.inventory.items().find(i => i.name === 'wheat_seeds');
    if (seeds) {
      await bot.toss(seeds.type, null, seeds.count);
    }
  }

  // Find any log nearby
  const logNames = ['spruce_log', 'oak_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log'];
  let logBlock = bot.findBlock({
    matching: b => logNames.includes(b.name),
    maxDistance: 32
  });
  if (!logBlock) {
    await exploreUntil('north', 60, () => {
      return bot.findBlock({
        matching: b => logNames.includes(b.name),
        maxDistance: 32
      });
    });
    logBlock = bot.findBlock({
      matching: b => logNames.includes(b.name),
      maxDistance: 32
    });
  }
  if (!logBlock) {
    throw new Error("Could not find any logs to craft a crafting table.");
  }
  const logName = logBlock.name;
  await mineBlock(logName, 1);

  // Craft planks (1 log = 4 planks)
  const planksName = logName.replace('_log', '_planks');
  await craftItem(planksName, 1);

  // Craft the crafting table
  await craftItem('crafting_table', 1);
}