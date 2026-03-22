async function mineOneOakLogTask(bot) {
  const targetName = 'oak_log';
  const targetCount = 1;

  // Check for the block in the immediate vicinity
  let log = bot.findBlock({
    matching: b => b.name === targetName,
    maxDistance: 32
  });

  // If not found, explore to locate the block
  if (!log) {
    await exploreUntil('north', 60, () => bot.findBlock({
      matching: b => b.name === targetName,
      maxDistance: 32
    }));
    log = bot.findBlock({
      matching: b => b.name === targetName,
      maxDistance: 32
    });
  }

  // If the block is found, move close to it first to assist the pathfinder
  if (log) {
    await moveTo(log.position.x, log.position.y, log.position.z, 2, 40);
    await mineBlock(targetName, targetCount);
  } else {
    // If exploration didn't find it, try mineBlock directly as a last resort
    // which may use its own internal search/pathfinding logic.
    await mineBlock(targetName, targetCount);
  }
}