async function plantWheatSeeds(bot) {
  // 1. Check if we have wheat seeds
  const wheatSeeds = bot.inventory.items().find(i => i.name === 'wheat_seeds');
  if (!wheatSeeds || wheatSeeds.count === 0) {
    // If no seeds, task cannot be completed.
    // In a real scenario, we might try to get seeds (e.g., break grass).
    // For now, assume the task implies we have them.
    return;
  }

  // 2. Find a water source
  let waterSource = await exploreUntil('forward', 60, () => {
    return bot.findBlock({
      matching: b => b.name === 'water',
      maxDistance: 32
    });
  });
  if (!waterSource) {
    // If no water found after exploration, give up.
    return;
  }

  // Move to the water source
  await moveTo(waterSource.position.x, waterSource.position.y, waterSource.position.z, 5, 30);

  // 3. Find a suitable dirt block near water to till
  let dirtBlockToTill = null;
  // Look for a dirt/grass block adjacent to water and on the same Y level or slightly higher
  // Also, make sure there's air above it for planting
  const waterPos = waterSource.position;
  const searchRadius = 4; // Search in a small radius around the water

  for (let x = -searchRadius; x <= searchRadius; x++) {
    for (let z = -searchRadius; z <= searchRadius; z++) {
      for (let y = -1; y <= 1; y++) {
        // Check slightly above/below water level
        const checkPos = waterPos.offset(x, y, z);
        const block = bot.blockAt(checkPos);
        if (block && (block.name === 'dirt' || block.name === 'grass_block')) {
          // Check if it's adjacent to water
          let adjacentToWater = false;
          for (const face of ['north', 'south', 'east', 'west']) {
            const neighbor = bot.blockAt(checkPos.offset(block.faces[face].x, block.faces[face].y, block.faces[face].z));
            if (neighbor && neighbor.name === 'water') {
              adjacentToWater = true;
              break;
            }
          }

          // Check if there's air above it
          const blockAbove = bot.blockAt(checkPos.offset(0, 1, 0));
          if (adjacentToWater && blockAbove && blockAbove.name === 'air') {
            dirtBlockToTill = block;
            break;
          }
        }
      }
      if (dirtBlockToTill) break;
    }
    if (dirtBlockToTill) break;
  }
  if (!dirtBlockToTill) {
    // Could not find a suitable spot near water.
    // In a real scenario, we might place dirt or dig a water channel.
    return;
  }

  // 4. Craft a hoe if we don't have one
  let hoe = bot.inventory.items().find(i => i.name.includes('_hoe'));
  if (!hoe) {
    // Try to craft a stone hoe first, then wood if stone materials are not available
    const cobblestone = bot.inventory.items().find(i => i.name === 'cobblestone');
    const sticks = bot.inventory.items().find(i => i.name === 'stick');
    if (cobblestone && cobblestone.count >= 2 && sticks && sticks.count >= 2) {
      await craftItem('stone_hoe', 1);
      hoe = bot.inventory.items().find(i => i.name === 'stone_hoe');
    } else {
      const oakPlanks = bot.inventory.items().find(i => i.name === 'oak_planks');
      if (oakPlanks && oakPlanks.count >= 2 && sticks && sticks.count >= 2) {
        await craftItem('wooden_hoe', 1);
        hoe = bot.inventory.items().find(i => i.name === 'wooden_hoe');
      } else {
        // Not enough materials for any hoe
        return;
      }
    }
  }

  // 5. Till the dirt block
  await bot.equip(hoe, 'hand');
  await moveTo(dirtBlockToTill.position.x, dirtBlockToTill.position.y, dirtBlockToTill.position.z, 1, 10);
  await bot.activateBlock(dirtBlockToTill);

  // 6. Equip wheat seeds and plant them
  await bot.equip(wheatSeeds, 'hand');
  // After tilling, the block might change type (e.g., from dirt to farmland).
  // Need to get the updated block at the position.
  const tilledBlock = bot.blockAt(dirtBlockToTill.position);
  if (tilledBlock && tilledBlock.name === 'farmland') {
    await bot.placeBlock(tilledBlock, new bot.Vec3(0, 1, 0)); // Place on top of farmland
  }
}