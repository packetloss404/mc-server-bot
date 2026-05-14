async function mine3SpruceLogs(bot) {
  let spruceLogBlock = bot.findBlock({
    matching: b => b.name === 'spruce_log',
    maxDistance: 32
  });
  if (!spruceLogBlock) {
    // If no spruce logs are nearby, explore until one is found
    await exploreUntil('north', 60000, () => {
      // Explore for up to 60 seconds
      spruceLogBlock = bot.findBlock({
        matching: b => b.name === 'spruce_log',
        maxDistance: 32
      });
      return spruceLogBlock;
    });
  }
  if (spruceLogBlock) {
    await mineBlock('spruce_log', 3);
  } else {
    throw new Error('Could not find spruce_log even after exploring.');
  }
}