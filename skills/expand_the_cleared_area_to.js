async function expandTo5x5Foundation(bot) {
  const Vec3 = bot.entity.position.constructor;

  // 1. Collect enough dirt/grass_block (at least 25 for a 5x5 foundation)
  const requiredBlocks = 25;
  let dirtCount = bot.inventory.items().find(i => i.name === 'dirt')?.count || 0;
  let grassBlockCount = bot.inventory.items().find(i => i.name === 'grass_block')?.count || 0;
  let totalFoundationBlocks = dirtCount + grassBlockCount;
  if (totalFoundationBlocks < requiredBlocks) {
    await mineBlock('dirt', requiredBlocks - totalFoundationBlocks);
    dirtCount = bot.inventory.items().find(i => i.name === 'dirt')?.count || 0;
    grassBlockCount = bot.inventory.items().find(i => i.name === 'grass_block')?.count || 0;
    totalFoundationBlocks = dirtCount + grassBlockCount;
    if (totalFoundationBlocks < requiredBlocks) {
      // If still not enough, try mining more aggressively or checking other blocks
      // For now, assume mineBlock is sufficient. If not, this will fail and get re-evaluated.
      console.log(`Warning: Only collected ${totalFoundationBlocks} foundation blocks, but ${requiredBlocks} are required.`);
    }
  }

  // Choose the block to place, preferring grass_block if available
  const foundationBlockName = grassBlockCount > 0 ? 'grass_block' : 'dirt';

  // 2. Determine the target 5x5 area
  // We want to create a 5x5 area centered around the bot's current X, Z.
  // The foundation should be at the level directly below the bot's feet.
  const botX = Math.floor(bot.entity.position.x);
  const botY = Math.floor(bot.entity.position.y - 1); // Foundation level
  const botZ = Math.floor(bot.entity.position.z);
  const startX = botX - 2;
  const endX = botX + 2;
  const startZ = botZ - 2;
  const endZ = botZ + 2;
  const blocksToModify = []; // Blocks to clear or place

  // Iterate over the 5x5 area
  for (let x = startX; x <= endX; x++) {
    for (let z = startZ; z <= endZ; z++) {
      const blockPos = new Vec3(x, botY, z);
      const blockAtPos = bot.blockAt(blockPos);

      // Check the block directly at the foundation level
      if (blockAtPos && blockAtPos.name !== foundationBlockName) {
        blocksToModify.push({
          type: 'place',
          pos: blockPos
        });
      }

      // Check if there's any block directly above the foundation level that needs clearing
      const blockAbovePos = new Vec3(x, botY + 1, z);
      const blockAbove = bot.blockAt(blockAbovePos);
      if (blockAbove && blockAbove.name !== 'air' && blockAbove.name !== 'cave_air' && blockAbove.name !== 'void_air') {
        blocksToModify.push({
          type: 'clear',
          pos: blockAbovePos
        });
      }
    }
  }

  // 3. Clear existing blocks if necessary
  for (const task of blocksToModify) {
    if (task.type === 'clear') {
      const block = bot.blockAt(task.pos);
      if (block && block.name !== 'air' && block.name !== 'cave_air' && block.name !== 'void_air') {
        await mineBlock(block.name, 1); // Mine the block
      }
    }
  }

  // 4. Place foundation blocks
  for (const task of blocksToModify) {
    if (task.type === 'place') {
      const block = bot.blockAt(task.pos);
      if (block && block.name !== foundationBlockName) {
        await placeItem(foundationBlockName, task.pos.x, task.pos.y, task.pos.z);
      }
    }
  }

  // Verify the foundation is complete
  let placedCount = 0;
  for (let x = startX; x <= endX; x++) {
    for (let z = startZ; z <= endZ; z++) {
      const blockPos = new Vec3(x, botY, z);
      const blockAtPos = bot.blockAt(blockPos);
      if (blockAtPos && blockAtPos.name === foundationBlockName) {
        placedCount++;
      }
    }
  }
  if (placedCount === 25) {
    console.log('Successfully expanded to a 5x5 flat foundation.');
  } else {
    console.log(`Foundation not fully complete. Placed ${placedCount} out of 25 blocks.`);
  }
}