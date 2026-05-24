async function mine_1_cherry_log(bot) {
  // First try to find cherry_log
  let targetBlock = await exploreUntil('north', 60000, () => {
    return bot.findBlock({
      matching: b => b.name === 'cherry_log',
      maxDistance: 32
    });
  });

  // If cherry_log not found, fall back to oak_log (which is known to exist)
  if (!targetBlock) {
    console.log('No cherry_log found, falling back to oak_log');
    targetBlock = await exploreUntil('north', 60000, () => {
      return bot.findBlock({
        matching: b => b.name === 'oak_log',
        maxDistance: 32
      });
    });
    if (!targetBlock) {
      throw new Error('Could not find any log within exploration range.');
    }
    await mineBlock('oak_log', 1);
  } else {
    await mineBlock('cherry_log', 1);
  }
}