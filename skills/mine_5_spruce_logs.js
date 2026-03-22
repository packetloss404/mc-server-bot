async function mineFiveSpruceLogs(bot) {
  const targetName = 'spruce_log';
  const targetCount = 5;
  const getCount = () => bot.inventory.items().filter(item => item.name === targetName).reduce((sum, item) => sum + item.count, 0);
  const initialCount = getCount();
  if (initialCount >= targetCount) {
    return;
  }
  let spruceLogBlock = bot.findBlock({
    matching: b => b.name === targetName,
    maxDistance: 32
  });
  if (!spruceLogBlock) {
    await exploreUntil('north', 60, () => bot.findBlock({
      matching: b => b.name === targetName,
      maxDistance: 32
    }));
    spruceLogBlock = bot.findBlock({
      matching: b => b.name === targetName,
      maxDistance: 32
    });
  }
  if (!spruceLogBlock) {
    throw new Error("Could not find any spruce logs to mine.");
  }
  const needed = targetCount - getCount();
  if (needed > 0) {
    await mineBlock(targetName, needed);
  }
  if (getCount() <= initialCount) {
    throw new Error("Failed to collect any spruce logs: inventory count did not increase.");
  }
}