async function mine1OakLogFromTheNearestKnownOakTree(bot) {
  const targetX = 1655;
  const targetY = 111;
  const targetZ = 266;
  const blockName = 'oak_log';
  const count = 1;

  // Move to the vicinity of the target block
  await moveTo(targetX, targetY, targetZ, 4, 30); // Move within 4 blocks, 30 sec timeout

  // Verify the block exists at the target location or nearby
  const targetBlockPos = new Vec3(targetX, targetY, targetZ);
  let oakLogBlock = bot.findBlock({
    matching: block => block.name === blockName,
    point: targetBlockPos,
    maxDistance: 32
  });
  if (!oakLogBlock) {
    // If not found exactly at the point, search more broadly around the bot's current position
    oakLogBlock = bot.findBlock({
      matching: block => block.name === blockName,
      maxDistance: 32
    });
  }
  if (!oakLogBlock) {
    // If still not found, explore for a short period
    console.log(`Could not find ${blockName} at ${targetX},${targetY},${targetZ}. Exploring...`);
    await exploreUntil(new Vec3(1, 0, 0), 60, () => {
      // Explore in positive X direction for 60 seconds
      return bot.findBlock({
        matching: block => block.name === blockName,
        maxDistance: 32
      });
    });
    oakLogBlock = bot.findBlock({
      matching: block => block.name === blockName,
      maxDistance: 32
    });
  }
  if (oakLogBlock) {
    await mineBlock(blockName, count);
  } else {
    console.log(`Failed to find any ${blockName} after exploration.`);
  }
}