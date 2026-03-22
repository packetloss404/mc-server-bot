async function mineSixSpruceLogs(bot) {
  const targetBlock = 'spruce_log';
  const targetCount = 6;
  while (true) {
    const item = bot.inventory.items().find(i => i.name === targetBlock);
    const currentCount = item ? item.count : 0;
    if (currentCount >= targetCount) {
      break;
    }
    const spruceLog = bot.findBlock({
      matching: b => b.name === targetBlock,
      maxDistance: 32
    });
    if (!spruceLog) {
      await exploreUntil('north', 120, () => {
        return bot.findBlock({
          matching: b => b.name === targetBlock,
          maxDistance: 32
        });
      });
    }
    await mineBlock(targetBlock, targetCount - currentCount);
  }
}