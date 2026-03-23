async function mineShortGrassForSeeds(bot) {
  let attempts = 0;
  while (attempts < 10) {
    const item = bot.inventory.items().find(i => i.name === 'wheat_seeds');
    if (item && item.count >= 1) {
      break;
    }
    const block = bot.findBlock({
      matching: b => b.name === 'short_grass',
      maxDistance: 32
    });
    if (!block) {
      await exploreUntil('north', 60, () => {
        return bot.findBlock({
          matching: b => b.name === 'short_grass',
          maxDistance: 32
        });
      });
    }
    try {
      await mineBlock('short_grass', 5);
    } catch (err) {
      // Ignore pathfinding or mining errors and retry
    }
    attempts++;
  }
}