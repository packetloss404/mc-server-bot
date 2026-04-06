async function mineThreeOakLogs(bot) {
  const targetName = 'oak_log';
  const targetCount = 3;
  const initialCount = bot.inventory.items().filter(i => i.name === targetName).reduce((acc, i) => acc + i.count, 0);
  const oakLogBlock = bot.findBlock({
    matching: block => block.name === targetName,
    maxDistance: 32
  });
  if (oakLogBlock) {
    await mineBlock(targetName, targetCount);
  } else {
    await exploreUntil(dir => dir, 60, () => bot.findBlock({
      matching: block => block.name === targetName,
      maxDistance: 32
    }));
    await mineBlock(targetName, targetCount);
  }
  const finalCount = bot.inventory.items().filter(i => i.name === targetName).reduce((acc, i) => acc + i.count, 0);
  if (finalCount < initialCount + targetCount) {
    const remaining = initialCount + targetCount - finalCount;
    await mineBlock(targetName, remaining);
  }
}