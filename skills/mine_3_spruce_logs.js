async function mineThreeSpruceLogsTask(bot) {
  const targetName = 'spruce_log';
  const targetCount = 3;
  const getCount = () => {
    const item = bot.inventory.items().find(i => i.name === targetName);
    return item ? item.count : 0;
  };
  const initialCount = getCount();
  let spruceLog = bot.findBlock({
    matching: b => b.name === targetName,
    maxDistance: 32
  });
  if (!spruceLog) {
    await exploreUntil('north', 60, () => bot.findBlock({
      matching: b => b.name === targetName,
      maxDistance: 32
    }));
  }
  await mineBlock(targetName, targetCount);
  const finalCount = getCount();
  if (finalCount < initialCount + targetCount) {
    const remaining = initialCount + targetCount - finalCount;
    await mineBlock(targetName, remaining);
  }
}