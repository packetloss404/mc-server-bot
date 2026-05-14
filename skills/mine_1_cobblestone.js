async function mine1Cobblestone(bot) {
  const targetBlock = await exploreUntil('south',
  // Start exploring in one direction, then the function will try others
  60000,
  // Explore for up to 60 seconds
  () => {
    return bot.findBlock({
      matching: block => block.name === 'cobblestone' || block.name === 'stone',
      maxDistance: 32
    });
  });
  if (!targetBlock) {
    throw new Error('Could not find any cobblestone or stone after exploring.');
  }

  // If we found a stone block, mine it, as it will drop cobblestone
  await mineBlock('stone', 1);
}