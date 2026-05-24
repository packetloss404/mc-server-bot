async function mine1OakLog(bot) {
  let oakLogBlock = bot.findBlock({
    matching: b => b.name === 'oak_log',
    maxDistance: 32
  });
  if (!oakLogBlock) {
    // Explore in multiple directions to find oak_log
    const directions = ['north', 'east', 'south', 'west'];
    for (const dir of directions) {
      oakLogBlock = await exploreUntil(dir, 15, () => bot.findBlock({
        matching: b => b.name === 'oak_log',
        maxDistance: 32
      }));
      if (oakLogBlock) break;
    }
  }
  if (!oakLogBlock) {
    // Last resort: longer exploration
    oakLogBlock = await exploreUntil('north', 30, () => bot.findBlock({
      matching: b => b.name === 'oak_log',
      maxDistance: 32
    }));
  }
  if (oakLogBlock) {
    await mineBlock('oak_log', 1);
  } else {
    throw new Error('Could not find oak_log even after exploring.');
  }
}