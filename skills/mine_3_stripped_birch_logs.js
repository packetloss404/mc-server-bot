async function mineThreeStrippedBirchLogs(bot) {
  const blockName = 'stripped_birch_log';
  const targetCount = 3;
  const currentCount = bot.inventory.items().filter(i => i.name === blockName).reduce((acc, i) => acc + i.count, 0);
  const needed = targetCount - currentCount;
  if (needed <= 0) return;
  const block = bot.findBlock({
    matching: b => b.name === blockName,
    maxDistance: 32
  });
  if (!block) {
    await exploreUntil('north', 60, () => {
      return !!bot.findBlock({
        matching: b => b.name === blockName,
        maxDistance: 32
      });
    });
  }
  await mineBlock(blockName, needed);
}