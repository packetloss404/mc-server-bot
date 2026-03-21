async function goToFarmland(bot) {
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
      await moveTo(farmland.position.x, farmland.position.y + 1, farmland.position.z, 1, 30);
    }
  } catch (err) {
    // Handle error silently
  }
}