async function mineThreeCoalOre(bot) {
  try {
    const coalOre = bot.findBlock({
      matching: b => b.name === 'coal_ore' || b.name === 'deepslate_coal_ore',
      maxDistance: 32
    });
    if (!coalOre) {
      await exploreUntil('north', 60, () => {
        return bot.findBlock({
          matching: b => b.name === 'coal_ore' || b.name === 'deepslate_coal_ore',
          maxDistance: 32
        });
      });
    }
    await mineBlock('coal_ore', 3);
  } catch (err) {
    // If coal_ore isn't found or specifically deepslate version is needed
    try {
      await mineBlock('deepslate_coal_ore', 3);
    } catch (innerErr) {
      console.error('Error mining coal ore:', err);
    }
  }
}