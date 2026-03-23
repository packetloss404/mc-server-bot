async function mineFiveKelp(bot) {
  const targetItem = 'kelp';
  const targetBlock = 'kelp_plant';
  const targetCount = 5;
  let attempts = 0;
  while (attempts < 10) {
    const item = bot.inventory.items().find(i => i.name === targetItem);
    const currentCount = item ? item.count : 0;
    if (currentCount >= targetCount) {
      break;
    }
    const block = bot.findBlock({
      matching: b => b.name === targetBlock || b.name === 'kelp',
      maxDistance: 32
    });
    if (!block) {
      await exploreUntil('north', 60, () => {
        return bot.findBlock({
          matching: b => b.name === targetBlock || b.name === 'kelp',
          maxDistance: 32
        });
      });
    }
    try {
      await mineBlock(targetBlock, targetCount - currentCount);
    } catch (err) {
      try {
        await mineBlock('kelp', targetCount - currentCount);
      } catch (err2) {
        // Ignore errors and retry
      }
    }
    attempts++;
  }
}