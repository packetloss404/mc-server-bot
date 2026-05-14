async function mine10Cobblestone(bot) {
  let cobblestoneCount = bot.inventory.items().find(item => item.name === 'cobblestone')?.count || 0;
  const targetCount = 10;
  while (cobblestoneCount < targetCount) {
    const blockToMine = bot.findBlock({
      matching: block => block.name === 'stone',
      maxDistance: 32
    });
    if (!blockToMine) { console.log("Block not found"); return; }
    if (blockToMine) {
      // Ensure a pickaxe is equipped
      let pickaxe = bot.inventory.items().find(item => item.name.includes('pickaxe'));
      if (!pickaxe) {
        // This scenario should ideally be handled by a higher-level skill to craft one
        // For now, if no pickaxe, cannot mine stone.
        throw new Error("No pickaxe found in inventory to mine stone.");
      }
      await bot.equip(pickaxe, 'hand');
      await mineBlock('stone', targetCount - cobblestoneCount);
      cobblestoneCount = bot.inventory.items().find(item => item.name === 'cobblestone')?.count || 0;
    } else {
      // No stone block found nearby, explore
      await exploreUntil('north', 60,
      // Explore for up to 60 seconds
      () => bot.findBlock({
        matching: block => block.name === 'stone',
        maxDistance: 32
      }));
      // After exploring, try to find the block again
      const foundBlockAfterExplore = bot.findBlock({
        matching: block => block.name === 'stone',
        maxDistance: 32
      });
      if (!foundBlockAfterExplore) {
        throw new Error("Could not find stone blocks after exploring.");
      }
    }
  }
}