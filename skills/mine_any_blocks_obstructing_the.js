async function mineBlocksToFurnace(bot) {
  const furnaceX = 937;
  const furnaceY = 76;
  const furnaceZ = 219;

  // Function to check if the path is clear
  const isPathClear = async () => {
    // Attempt to move to the furnace. If successful, the path is clear enough.
    // If it gets stuck due to an obstruction, moveTo will return false or throw.
    try {
      await moveTo(furnaceX, furnaceY, furnaceZ, 1, 5); // Try to move to it, small timeout
      return true; // If we can move there, path is clear enough
    } catch (error) {
      // If moveTo fails, it likely means there's an obstruction.
      // We don't need to log here, just indicate the path is not clear.
      return false;
    }
  };

  // Keep trying to clear the path until it's clear
  let pathIsObstructed = true;
  while (pathIsObstructed) {
    if (await isPathClear()) {
      pathIsObstructed = false; // Path is clear, exit loop
      continue;
    }

    // Path is not clear, find and mine obstructing blocks
    // We need to find blocks between the bot's current position and the furnace.
    // This is a simplified approach, assuming the bot is somewhat aligned.
    // A more robust solution would involve pathfinding and identifying problematic blocks.

    // For now, let's try to find any block within a reasonable distance that is NOT the furnace itself
    // and is on a direct line or close to it.
    // This is a heuristic. We'll search for blocks that are not air and are within a bounding box
    // between bot and furnace.

    const botPos = bot.entity.position;
    const furnacePos = {
      x: furnaceX,
      y: furnaceY,
      z: furnaceZ
    };

    // Define a bounding box for exploration
    const minX = Math.min(botPos.x, furnacePos.x) - 2;
    const maxX = Math.max(botPos.x, furnacePos.x) + 2;
    const minY = Math.min(botPos.y, furnacePos.y) - 2;
    const maxY = Math.max(botPos.y, furnacePos.y) + 2;
    const minZ = Math.min(botPos.z, furnacePos.z) - 2;
    const maxZ = Math.max(botPos.z, furnacePos.z) + 2;
    let obstructingBlock = null;

    // Explore until a target block is found or time runs out
    await exploreUntil('forward', 30, block => {
      // 30 seconds max exploration
      if (block && block.name !== 'air' && block.name !== 'water' && block.name !== 'lava' && block.name !== 'furnace') {
        // Check if the block is within our defined bounding box
        if (block.position.x >= minX && block.position.x <= maxX && block.position.y >= minY && block.position.y <= maxY && block.position.z >= minZ && block.position.z <= maxZ) {
          obstructingBlock = block;
          return obstructingBlock.position; // Return position to move towards
        }
      }
      return null;
    });
    if (obstructingBlock) {
      // Move to the obstructing block and mine it
      await moveTo(obstructingBlock.position.x, obstructingBlock.position.y, obstructingBlock.position.z, 1, 10);
      await mineBlock(obstructingBlock.name, 1);
    } else {
      // If no explicit obstructing block was found after exploration,
      // it might be a pathfinding issue or a small, hard-to-find obstruction.
      // Try to move to the furnace again with a longer timeout to see if it resolves.
      try {
        await moveTo(furnaceX, furnaceY, furnaceZ, 1, 15); // Longer timeout
        pathIsObstructed = false; // If this succeeds, path is clear
      } catch (e) {
        // Still stuck, maybe we need to explore more broadly or consider different strategies.
        // For now, assume a single pass of exploration and mining is sufficient.
        // If it still fails, the loop will continue.
        // To prevent infinite loops in complex scenarios, a counter or more sophisticated logic might be needed.
        await bot.waitForTicks(20); // Wait a bit before retrying to avoid spamming
      }
    }
  }

  // Once the path is clear, move to the furnace one last time
  await moveTo(furnaceX, furnaceY, furnaceZ, 1, 30);
}