async function walkToTheNearestFarmland(bot) {
  try {
    let farmland = bot.findBlock({
      matching: block => block.name === 'farmland',
      maxDistance: 32
    });

    if (!farmland) {
      farmland = await exploreUntil('north', 60, () => {
        return bot.findBlock({
          matching: block => block.name === 'farmland',
          maxDistance: 32
        });
      });
    }

    if (farmland) {
      const pos = farmland.position;
      await moveTo(pos.x, pos.y + 1, pos.z, 1, 30);
    }
  } catch (err) {
    // Handle errors silently
  }
}