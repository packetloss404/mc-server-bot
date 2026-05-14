async function mine3SpruceLogs(bot) {
  let spruceLogBlock = bot.findBlock({
    matching: b => b.name === 'spruce_log',
    maxDistance: 32
  });
  if (!spruceLogBlock) {
    // If spruce log is not found nearby, explore
    await exploreUntil('forward', 600, () => {
      // Explore for 30 seconds (600 ticks)
      spruceLogBlock = bot.findBlock({
        matching: b => b.name === 'spruce_log',
        maxDistance: 32
      });
      return spruceLogBlock; // Return the block if found, otherwise keep exploring
    });
  }
  if (spruceLogBlock) {
    // If a spruce log block was found (either initially or after exploring), then mine it.
    // mineBlock primitive will handle moving to the block and mining it.
    await mineBlock('spruce_log', 3);
  } else {
    throw new Error('Could not find spruce_log after exploring.');
  }
}