async function mineOneSpruceLog(bot) {
  const targetName = 'spruce_log';
  const targetCount = 1;
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
    await exploreUntil('north', 60, () => {
      return bot.findBlock({
        matching: b => b.name === targetName,
        maxDistance: 32
      });
    });
    spruceLog = bot.findBlock({
      matching: b => b.name === targetName,
      maxDistance: 32
    });
  }
  if (!spruceLog) {
    throw new Error("Could not find any spruce logs nearby.");
  }
  await mineBlock(targetName, targetCount);
  const finalCount = getCount();
  if (finalCount <= initialCount) {
    throw new Error("Inventory did not gain the expected spruce log.");
  }
}