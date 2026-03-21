async function getMoreWheatSeeds(bot) {
  try {
    const targetCount = 5;
    const getSeedsCount = () => {
      const item = bot.inventory.items().find(i => i.name === 'wheat_seeds');
      return item ? item.count : 0;
    };

    while (getSeedsCount() < targetCount) {
      let grass = bot.findBlock({
        matching: (block) => ['short_grass', 'grass', 'tall_grass'].includes(block.name),
        maxDistance: 32
      });

      if (!grass) {
        await exploreUntil(bot, 'north', 60, () => {
          return bot.findBlock({
            matching: (block) => ['short_grass', 'grass', 'tall_grass'].includes(block.name),
            maxDistance: 32
          });
        });
        grass = bot.findBlock({
          matching: (block) => ['short_grass', 'grass', 'tall_grass'].includes(block.name),
          maxDistance: 32
        });
      }

      if (grass) {
        await mineBlock(grass.name, 1);
        await bot.waitForTicks(10);
      } else {
        // If still no grass found after exploring, move a bit and try again
        const pos = bot.entity.position;
        await moveTo(pos.x + 10, pos.y, pos.z + 10, 2, 20);
      }
    }
  } catch (error) {
    // Handle potential errors during exploration or mining
  }
}