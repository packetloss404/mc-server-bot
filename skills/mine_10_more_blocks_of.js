async function mine10DirtOrGrassWithShovel(bot) {
  const shovel = bot.inventory.items().find(i => i.name === 'wooden_shovel');
  if (!shovel) {
    // If no shovel, the task cannot be completed.
    // In a real scenario, we might try to craft one, but for this task, we assume it's available.
    throw new Error("Cannot mine dirt or grass without a wooden_shovel.");
  }

  // Equip the wooden_shovel
  await bot.equip(shovel, 'hand');
  let minedCount = 0;
  while (minedCount < 10) {
    let targetBlock = bot.findBlock({
      matching: b => b.name === 'dirt' || b.name === 'grass_block',
      maxDistance: 32
    });
    if (!targetBlock) {
      // If no target block nearby, explore until one is found
      const found = await exploreUntil('north',
      // Or any direction, the goal is just to move and find
      60,
      // Explore for up to 60 seconds
      () => bot.findBlock({
        matching: b => b.name === 'dirt' || b.name === 'grass_block',
        maxDistance: 32
      }));
      if (!found) {
        throw new Error("Could not find dirt or grass blocks after exploring.");
      }
      targetBlock = found;
    }

    // Mine one block at a time to keep track of the count
    await mineBlock(targetBlock.name, 1);
    minedCount++;
  }
}