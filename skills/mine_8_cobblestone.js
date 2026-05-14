async function mine8Cobblestone(bot) {
  let stoneBlock = bot.findBlock({
    matching: b => b.name === 'stone',
    maxDistance: 32
  });
  if (!stoneBlock) {
    // If no stone block is nearby, explore to find one
    await exploreUntil('north', 60,
    // Explore for up to 60 seconds
    () => bot.findBlock({
      matching: b => b.name === 'stone',
      maxDistance: 32
    }));
    stoneBlock = bot.findBlock({
      matching: b => b.name === 'stone',
      maxDistance: 32
    });
  }
  if (stoneBlock) {
    // Ensure a pickaxe is equipped
    const pickaxe = bot.inventory.items().find(item => item.name.includes('pickaxe'));
    if (pickaxe) {
      await bot.equip(pickaxe, 'hand');
    } else {
      // This scenario should ideally be handled by a higher-level skill to craft a pickaxe
      // For now, assume a pickaxe exists or fail
      throw new Error('No pickaxe found to mine stone.');
    }
    await mineBlock('stone', 8);
  } else {
    throw new Error('Could not find stone blocks to mine after exploring.');
  }
}