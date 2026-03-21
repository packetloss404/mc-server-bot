async function findWaterSource(bot) {
  try {
    bot.chat("Looking for water...");
    const water = bot.findBlock({
      matching: (block) => block.name === "water",
      maxDistance: 32,
    });

    if (water) {
      bot.chat(`Found water at ${water.position.x}, ${water.position.y}, ${water.position.z}`);
    } else {
      bot.chat("Could not find water nearby.");
    }
  } catch (err) {
    bot.chat(`Error finding water: ${err}`);
  }
}