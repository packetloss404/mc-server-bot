async function collectWheatSeeds(bot) {
  try {
    const targetCount = 64;
    const getSeedsCount = () => {
      const items = bot.inventory.items();
      const seedItem = items.find(i => i.name === 'wheat_seeds');
      return seedItem ? seedItem.count : 0;
    };

    while (getSeedsCount() < targetCount) {
      let targetBlock = bot.findBlock({
        matching: block => ['grass', 'short_grass', 'tall_grass'].includes(block.name),
        maxDistance: 32
      });

      if (!targetBlock) {
        targetBlock = await exploreUntil('north', 60, () => {
          return bot.findBlock({
            matching: block => ['grass', 'short_grass', 'tall_grass'].includes(block.name),
            maxDistance: 32
          });
        });
      }

      if (targetBlock) {
        await mineBlock(targetBlock.name, 1);
      } else {
        const pos = bot.entity.position;
        await moveTo(pos.x + 10, pos.y, pos.z + 10, 2, 10);
      }
      await bot.waitForTicks(10);
    }
  } catch (error) {
    // Handle error gracefully
  }
}