async function mineThreeBirchLogs(bot) {
  const itemName = 'birch_log';
  const targetCount = 3;
  const getCount = () => bot.inventory.items().filter(i => i.name === itemName).reduce((acc, i) => acc + i.count, 0);
  let currentCount = getCount();
  if (currentCount >= targetCount) return;
  let block = bot.findBlock({
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
  await mineBlock(itemName, targetCount - currentCount);
}