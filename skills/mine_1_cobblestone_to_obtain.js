async function mineCobblestoneForFurnace(bot) {
  let stoneBlock = bot.findBlock({
    matching: b => b.name === 'stone',
    maxDistance: 32
  });
  if (!stoneBlock) {
    await exploreUntil('north', 60,
    // Explore for up to 60 seconds
    () => bot.findBlock({
      matching: b => b.name === 'stone',
      maxDistance: 32
    }));
    stoneBlock = bot.findBlock({
      matching: b => b.name === 'stone',
      maxDistance: 32
    });
  }
  if (stoneBlock) {
    await mineBlock('stone', 1);
  } else {
    throw new Error("Could not find stone block to mine for cobblestone.");
  }
}