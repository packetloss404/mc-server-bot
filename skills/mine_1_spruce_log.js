async function mine1SpruceLog(bot) {
  const spruceLogBlock = bot.findBlock({
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
  }

  // After exploring, try to find the block again
  const targetBlock = bot.findBlock({
    matching: b => b.name === 'spruce_log',
    maxDistance: 32
  });
  if (!targetBlock) { console.log("Block not found"); return; }
  if (targetBlock) {
    await mineBlock('spruce_log', 1);
  } else {
    throw new Error('Could not find spruce_log even after exploring.');
  }
}