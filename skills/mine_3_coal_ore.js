async function mine3CoalOre(bot) {
  let coalOreBlock = bot.findBlock({
    matching: b => b.name === 'coal_ore',
    maxDistance: 32
  });
  if (!coalOreBlock) {
    await exploreUntil('north', 120,
    // Explore for 2 minutes (120 seconds)
    () => bot.findBlock({
      matching: b => b.name === 'coal_ore',
      maxDistance: 32
    }));
    coalOreBlock = bot.findBlock({
      matching: b => b.name === 'coal_ore',
      maxDistance: 32
    });
  }
  if (coalOreBlock) {
    await mineBlock('coal_ore', 3);
  } else {
    // If still no coal_ore found after exploring, the task cannot be completed.
    throw new Error('Could not find 3 coal_ore to mine after extensive exploration.');
  }
}