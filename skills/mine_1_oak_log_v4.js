async function mine1OakLog(bot) {
  // First check if there's an oak_log nearby
  let oakLogBlock = bot.findBlock({
    matching: b => b.name === 'oak_log',
    maxDistance: 32
  });
  if (!oakLogBlock) {
    await exploreUntil('north', 30, () => bot.findBlock({
      matching: b => b.name === 'oak_log',
      maxDistance: 32
    }));
    oakLogBlock = bot.findBlock({
      matching: b => b.name === 'oak_log',
      maxDistance: 32
    });
  }
  if (!oakLogBlock) {
    throw new Error('Could not find oak_log even after exploring.');
  }

  // Check if the oak_log is adjacent to water on any side
  // If so, we need to approach from the side opposite the water
  const pos = oakLogBlock.position;
  const offsets = [{
    x: 1,
    y: 0,
    z: 0
  }, {
    x: -1,
    y: 0,
    z: 0
  }, {
    x: 0,
    y: 0,
    z: 1
  }, {
    x: 0,
    y: 0,
    z: -1
  }];
  let safePosition = null;
  for (const offset of offsets) {
    const checkPos = pos.offset(offset.x, offset.y, offset.z);
    const block = bot.blockAt(checkPos);
    if (block && block.name !== 'water' && block.name !== 'lava') {
      safePosition = checkPos;
      break;
    }
  }
  if (safePosition) {
    await moveTo(safePosition.x, safePosition.y, safePosition.z, 1, 10);
  } else {
    // No safe side found, just move to any adjacent non-water block
    await moveTo(pos.x + 1, pos.y, pos.z + 1, 1, 10);
  }

  // Now mine the oak_log - it should fall toward us
  await mineBlock('oak_log', 1);

  // Small delay to let item physics settle
  await bot.waitForTicks(5);
}