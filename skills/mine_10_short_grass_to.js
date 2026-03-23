async function collectTenWheatSeeds(bot) {
  const targetCount = 10;
  let attempts = 0;
  while (attempts < 20) {
    const item = bot.inventory.items().find(i => i.name === 'wheat_seeds');
    if (item && item.count >= targetCount) {
      break;
    }
    const block = bot.findBlock({
      matching: b => b.name === 'short_grass',
      maxDistance: 32
    });
    if (!block) {
      await exploreUntil('north', 30, () => {
        return bot.findBlock({
          matching: b => b.name === 'short_grass',
          maxDistance: 32
        });
      });
    }
    try {
      await mineBlock('short_grass', 2);
    } catch (err) {
      // Ignore pathfinding errors and retry
    }
    attempts++;
  }
}