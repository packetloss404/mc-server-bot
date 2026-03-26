async function mineOneOakLog(bot) {
  const targetName = 'oak_log';
  const targetCount = 1;
  const getCount = () => {
    const item = bot.inventory.items().find(i => i.name === targetName);
    return item ? item.count : 0;
  };
  const initialCount = getCount();
  const findTarget = () => bot.findBlock({
    matching: b => b.name === targetName,
    maxDistance: 32
  });
  let target = findTarget();
  if (!target) {
    await exploreUntil("north", 60, () => {
      return bot.findBlock({
        matching: b => b.name === 'oak_log',
        maxDistance: 32
      });
    });
  }
  await mineBlock(targetName, targetCount);

  // Check if we actually got the log. If not, try again to handle potential item pick-up delays or failures.
  const currentCount = getCount();
  if (currentCount <= initialCount) {
    await mineBlock(targetName, targetCount);
  }
}