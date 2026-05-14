async function mineCoalOreWithStonePickaxe(bot) {
  let coalOreCount = 0;
  while (coalOreCount < 10) {
    const coalOreBlock = bot.findBlock({
      matching: b => b.name === 'coal_ore',
      maxDistance: 32
    });
    if (!coalOreBlock) { console.log("Block not found"); return; }
    if (coalOreBlock) {
      await mineBlock('coal_ore', 1, 'stone_pickaxe');
      coalOreCount++;
    } else {
      // If no coal_ore is nearby, explore to find some
      await exploreUntil('north',
      // Start exploring in a direction, e.g., 'north'
      60,
      // Explore for up to 60 seconds
      () => bot.findBlock({
        matching: b => b.name === 'coal_ore',
        maxDistance: 32
      }));
      // After exploring, check again if coal_ore is found
      const foundCoalOreAfterExplore = bot.findBlock({
        matching: b => b.name === 'coal_ore',
        maxDistance: 32
      });
      if (!foundCoalOreAfterExplore) {
        // If still no coal_ore after exploring, we might be stuck or out of range
        // This task assumes coal_ore is findable; if not, it will eventually time out.
        throw new Error("Could not find coal_ore after extensive exploration.");
      }
    }
  }
}