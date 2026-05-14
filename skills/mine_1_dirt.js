async function mine1Dirt(bot) {
  let dirtBlock = bot.findBlock({
    matching: block => block.name === 'dirt',
    maxDistance: 32
  });
  if (!dirtBlock) {
    // If no dirt is nearby, explore to find some
    await exploreUntil('north', 60,
    // Explore for up to 60 seconds
    () => {
      dirtBlock = bot.findBlock({
        matching: block => block.name === 'dirt',
        maxDistance: 32
      });
      return dirtBlock ? dirtBlock.position : null;
    });
  }
  if (dirtBlock) {
    await mineBlock('dirt', 1);
  } else {
    throw new Error('Could not find dirt block after exploring.');
  }
}