async function findWheatSeeds(bot) {
  try {
    bot.chat("Looking for wheat seeds...");
    let seedsFound = 0;
    const targetSeeds = 1;

    while (seedsFound < targetSeeds) {
      const grass = bot.findBlock({
        matching: (block) => ["short_grass", "grass"].includes(block.name),
        maxDistance: 32,
      });

      if (grass) {
        bot.chat(`Breaking grass at ${grass.position.x}, ${grass.position.y}, ${grass.position.z}`);
        await moveTo(grass.position.x, grass.position.y, grass.position.z, 1, 15);
        const blockToDig = bot.blockAt(grass.position);
        if (blockToDig) {
          await bot.dig(blockToDig);
          // Wait a moment for the item to drop and be picked up
          await bot.waitForTicks(10);
        }
      } else {
        bot.chat("No grass nearby, wandering to find some...");
        const pos = bot.entity.position;
        const dx = (Math.random() - 0.5) * 40;
        const dz = (Math.random() - 0.5) * 40;
        await moveTo(pos.x + dx, pos.y, pos.z + dz, 2, 20);
      }

      const seedItem = bot.inventory.items().find(item => item.name === "wheat_seeds");
      if (seedItem) {
        seedsFound = seedItem.count;
        bot.chat(`I have found ${seedsFound} wheat seeds!`);
      }
    }
  } catch (err) {
    bot.chat(`Error while finding seeds: ${err.message}`);
  }
}