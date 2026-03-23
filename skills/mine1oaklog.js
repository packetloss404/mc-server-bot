async function mineOneOakLog(bot) {
  const targetName = 'oak_log';
  const targetCount = 1;
  const getCount = () => {
    const item = bot.inventory.items().find(i => i.name === targetName);
    return item ? item.count : 0;
  };
  const initialCount = getCount();
  let oakLog = bot.findBlock({
    matching: b => b.name === targetName,
    maxDistance: 32
  });
  if (!oakLog) {
    await exploreUntil('north', 60, () => bot.findBlock({
      matching: b => b.name === targetName,
      maxDistance: 32
    }));
  }
  await mineBlock(targetName, targetCount);
  const finalCount = getCount();
  if (finalCount <= initialCount) {
    // Attempt one more time if inventory didn't increase
    await mineBlock(targetName, targetCount);
  }
}