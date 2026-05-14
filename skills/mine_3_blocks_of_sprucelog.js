async function mine3SpruceLogs(bot) {
  let spruceLogBlock = bot.findBlock({
    matching: b => b.name === 'spruce_log',
    maxDistance: 32
  });
  if (!spruceLogBlock) {
    await exploreUntil('north', 60,
    // Explore for up to 60 seconds
    () => bot.findBlock({
      matching: b => b.name === 'spruce_log',
      maxDistance: 32
    }));
    spruceLogBlock = bot.findBlock({
      matching: b => b.name === 'spruce_log',
      maxDistance: 32
    });
  }
  if (spruceLogBlock) {
    await mineBlock('spruce_log', 3);
  } else {
    throw new Error('Could not find spruce_log after exploring.');
  }
}