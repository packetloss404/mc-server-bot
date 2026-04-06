async function mineTheNearestOakLog(bot) {
  const oakLogBlock = bot.findBlock({
    matching: block => block.name === 'oak_log',
    maxDistance: 32
  });
  if (oakLogBlock) {
    await mineBlock('oak_log', 1);
  } else {
    const foundBlock = await exploreUntil(bot, 'north', 60, () => {
      return bot.findBlock({
        matching: block => block.name === 'oak_log',
        maxDistance: 32
      });
    });
    if (foundBlock) {
      await mineBlock('oak_log', 1);
    }
  }
}