async function obtainCobblestone(bot) {
  // Check if the bot has a pickaxe equipped
  const pickaxe = bot.inventory.items().find(item => item.name.includes('_pickaxe'));
  if (!pickaxe) {
    // If no pickaxe, assume the task is to get cobblestone for a pickaxe and mine by hand if necessary,
    // or if the task implies a small amount, but for now, assume we need to mine with a pickaxe.
    // For simplicity, we'll assume a pickaxe is needed and if none, we can't mine stone efficiently.
    // In a real scenario, we might need to craft one first, but that's out of scope for this specific task.
    console.log("No pickaxe found. Cannot mine stone efficiently.");
    return; // Cannot proceed without a pickaxe for stone
  }

  // Equip the pickaxe if not already equipped
  const equippedItem = bot.heldItem;
  if (!equippedItem || !equippedItem.name.includes('_pickaxe')) {
    await bot.equip(pickaxe, 'hand');
  }

  // The task is "Obtain cobblestone". Since no specific amount is given,
  // we'll aim for a reasonable default, e.g., 8 for a furnace.
  const targetCobblestoneCount = 8;
  let currentCobblestoneCount = bot.inventory.items().find(item => item.name === 'cobblestone')?.count || 0;
  while (currentCobblestoneCount < targetCobblestoneCount) {
    const needed = targetCobblestoneCount - currentCobblestoneCount;

    // Find nearby stone blocks
    const stoneBlock = bot.findBlock({
      matching: block => block.name === 'stone',
      maxDistance: 32
    });
    if (!stoneBlock) { console.log("Block not found"); return; }
    if (stoneBlock) {
      await moveTo(stoneBlock.position.x, stoneBlock.position.y, stoneBlock.position.z, 1, 10);
      await mineBlock('stone', Math.min(needed, 1)); // Mine one at a time to update count
    } else {
      // If no stone found nearby, explore to find some
      await exploreUntil('forward', 60, () => {
        const foundStone = bot.findBlock({
          matching: block => block.name === 'stone',
          maxDistance: 32
        });
        if (!foundStone) { console.log("Block not found"); return; }
        return foundStone ? foundStone.position : null;
      });
      // After exploration, try to find and mine again
      const newStoneBlock = bot.findBlock({
        matching: block => block.name === 'stone',
        maxDistance: 32
      });
      if (!newStoneBlock) {
        console.log("Could not find stone after exploring.");
        return; // Give up if no stone found after exploration
      }
      await moveTo(newStoneBlock.position.x, newStoneBlock.position.y, newStoneBlock.position.z, 1, 10);
      await mineBlock('stone', Math.min(needed, 1));
    }

    // Update cobblestone count after mining
    currentCobblestoneCount = bot.inventory.items().find(item => item.name === 'cobblestone')?.count || 0;
  }
}