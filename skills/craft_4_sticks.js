async function craftFourSticks(bot) {
  const currentSticks = bot.inventory.items().find(i => i.name === 'stick');
  if (currentSticks && currentSticks.count >= 4) {
    return;
  }

  // Inventory is nearly full (34/36), toss one stack of seeds to ensure space for log, planks, and sticks
  const seeds = bot.inventory.items().find(i => i.name === 'wheat_seeds');
  if (seeds) {
    await bot.toss(seeds.type, null, seeds.count);
  }

  // Mine 1 oak log
  const logBlock = bot.findBlock({
    matching: b => b.name === 'oak_log',
    maxDistance: 32
  });
  if (!logBlock) {
    await exploreUntil('north', 60, () => {
      return bot.findBlock({
        matching: b => b.name === 'oak_log',
        maxDistance: 32
      });
    });
  }
  await mineBlock('oak_log', 1);

  // Craft planks (1 log -> 4 planks)
  await craftItem('oak_planks', 1);

  // Craft sticks (2 planks -> 4 sticks)
  await craftItem('stick', 1);
}