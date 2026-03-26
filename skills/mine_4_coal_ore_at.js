async function mineFourCoalOre(bot) {
  const targetBlock = 'coal_ore';
  const targetCount = 4;

  // Check if coal_ore is nearby
  let coalOre = bot.findBlock({
    matching: b => b.name === targetBlock,
    maxDistance: 32
  });

  // If not found, explore towards the known coordinate area
  if (!coalOre) {
    await moveTo(853, 62, 249, 5, 30);
    coalOre = bot.findBlock({
      matching: b => b.name === targetBlock,
      maxDistance: 32
    });
  }

  // If still not found after moving, explore generally
  if (!coalOre) {
    await exploreUntil('south', 60, () => {
      return bot.findBlock({
        matching: b => b.name === targetBlock,
        maxDistance: 32
      });
    });
  }

  // Mine the required amount
  await mineBlock(targetBlock, targetCount);
}