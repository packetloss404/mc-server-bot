async function mine3Cobblestone(bot) {
  const targetBlockName = 'stone';
  const countToMine = 3;

  // Check if we have a suitable pickaxe
  let pickaxe = bot.inventory.items().find(item => item.name.includes('pickaxe'));
  if (!pickaxe) {
    // If no pickaxe, consider crafting one if we have wood/cobblestone
    // For now, assume a pickaxe is available or will be handled by a higher-level task
    // Or, proceed with bare hands, which might be slow or impossible for stone
    // Given the inventory has 'wooden_pickaxe x1', we should use that.
    pickaxe = bot.inventory.items().find(item => item.name === 'wooden_pickaxe');
  }
  if (pickaxe) {
    await bot.equip(pickaxe, 'hand');
  }
  let stoneBlock = bot.findBlock({
    matching: b => b.name === targetBlockName,
    maxDistance: 32
  });
  if (!stoneBlock) {
    await exploreUntil('north',
    // Start exploring in one direction
    60,
    // Explore for up to 60 seconds
    () => bot.findBlock({
      matching: b => b.name === targetBlockName,
      maxDistance: 32
    }));
    stoneBlock = bot.findBlock({
      matching: b => b.name === targetBlockName,
      maxDistance: 32
    });
  }
  if (stoneBlock) {
    await mineBlock(targetBlockName, countToMine);
  } else {
    throw new Error('Could not find stone blocks to mine after exploring.');
  }
}