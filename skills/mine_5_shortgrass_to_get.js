async function mineShortGrassForWheatSeeds(bot) {
  let attempts = 0;
  let initialSeeds = bot.inventory.items().find(i => i.name === 'wheat_seeds')?.count || 0;
  while (attempts < 20) {
    let currentSeeds = bot.inventory.items().find(i => i.name === 'wheat_seeds')?.count || 0;
    if (currentSeeds > initialSeeds) {
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
      await mineBlock('short_grass', 1);
    } catch (err) {
      // Ignore pathfinding errors and retry
    }
    attempts++;
  }
}