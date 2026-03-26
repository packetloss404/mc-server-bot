async function craftCopperBlocks(bot) {
  // Check if we have 54 copper ingots needed for 6 copper blocks (9 per block)
  const copperIngots = bot.inventory.items().find(i => i.name === 'copper_ingot');
  const ingotCount = copperIngots ? copperIngots.count : 0;
  if (ingotCount < 54) {
    // Need to collect copper ingots - explore to find copper ore or smelt it
    await exploreUntil('outward', 120, () => {
      return bot.findBlock({
        matching: b => b.name === 'copper_ore',
        maxDistance: 32
      });
    });
    const copperOre = bot.findBlock({
      matching: b => b.name === 'copper_ore',
      maxDistance: 32
    });
    if (copperOre) {
      await moveTo(copperOre.position.x, copperOre.position.y, copperOre.position.z, 4, 30);
      const needed = 54 - ingotCount;
      await mineBlock('copper_ore', Math.ceil(needed / 2)); // Mine enough ore

      // Smelt copper ore to get ingots
      await smeltItem('copper_ingot', 'coal', needed);
    }
  }

  // Move to crafting table at (881, 73, 223)
  await moveTo(881, 73, 223, 2, 30);

  // Craft 6 copper blocks (9 copper ingots per block in 3x3 pattern)
  for (let i = 0; i < 6; i++) {
    await craftItem('copper_block', 1);
  }
}