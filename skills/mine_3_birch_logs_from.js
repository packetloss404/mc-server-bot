async function mineThreeBirchLogs(bot) {
  const itemName = 'birch_log';
  const targetCount = 3;
  const currentCount = bot.inventory.items().filter(i => i.name === itemName).reduce((acc, i) => acc + i.count, 0);
  const needed = targetCount - currentCount;
  if (needed <= 0) return;
  const block = bot.findBlock({
    matching: b => b.name === itemName,
    maxDistance: 32
  });
  if (!block) {
    await exploreUntil('north', 60, () => {
      return !!bot.findBlock({
        matching: b => b.name === itemName,
        maxDistance: 32
      });
    });
  }
  await mineBlock(itemName, needed);
}