async function walkToNearestFarmland(bot) {
  try {
    bot.chat("Searching for nearest farmland...");
    let farmland = bot.findBlock({
      matching: block => block.name === 'farmland',
      maxDistance: 32
    });

    if (!farmland) {
      bot.chat("Farmland not nearby. Exploring...");
      farmland = await exploreUntil({ x: 1, y: 0, z: 0 }, 60, () => {
        return bot.findBlock({
          matching: block => block.name === 'farmland',
          maxDistance: 32
        });
      });
    }

    if (farmland) {
      const pos = farmland.position;
      bot.chat(`Found farmland at ${pos.x}, ${pos.y}, ${pos.z}. Moving there...`);
      await moveTo(pos.x, pos.y, pos.z, 1, 30);
      bot.chat("Reached the farmland.");
    } else {
      bot.chat("Could not find any farmland in the area.");
    }
  } catch (err) {
    bot.chat(`Error walking to farmland: ${err.message}`);
  }
}