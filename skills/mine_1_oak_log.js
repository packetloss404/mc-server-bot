async function mine1OakLog(bot) {
  let oakLogBlock = bot.findBlock({
    matching: b => b.name === 'oak_log',
    maxDistance: 32
  });
  if (!oakLogBlock) {
    await exploreUntil('north', 60,
    // Explore for 60 seconds
    () => bot.findBlock({
      matching: b => b.name === 'oak_log',
      maxDistance: 32
    }));
    oakLogBlock = bot.findBlock({
      matching: b => b.name === 'oak_log',
      maxDistance: 32
    });
  }
  if (oakLogBlock) {
    await mineBlock('oak_log', 1);
  } else {
    throw new Error('Could not find oak_log even after exploring.');
  }
}