async function mine1CherryLog(bot) {
  const targetBlock = await exploreUntil('north', 60000, () => {
    // Explore for up to 60 seconds
    return bot.findBlock({
      matching: b => b.name === 'cherry_log',
      maxDistance: 32
    });
  });
  if (!targetBlock) {
    throw new Error('Could not find any cherry_log within exploration range.');
  }

  // Once found, mine the block. The mineBlock primitive will handle moving to it.
  await mineBlock('cherry_log', 1);
}