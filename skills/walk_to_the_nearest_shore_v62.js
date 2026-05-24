async function walkToTheNearestShore(bot) {
  // Step 1: Swim to surface first if needed
  const swimToSurface = () => {
    const eyePos = bot.entity.position.offset(0, bot.entity.eyeHeight, 0);
    const eyeBlock = bot.blockAt(eyePos);
    const feetBlock = bot.blockAt(bot.entity.position);
    return eyeBlock && eyeBlock.name.includes('water') || feetBlock && feetBlock.name.includes('water');
  };
  if (swimToSurface()) {
    bot.setControlState('jump', true);
    bot.setControlState('forward', true);
    bot.setControlState('sprint', true);
    const startTime = Date.now();
    while (Date.now() - startTime < 15000) {
      await bot.waitForTicks(5);
      if (!swimToSurface()) break;
    }
    bot.clearControlStates();
    await bot.waitForTicks(10);
  }

  // Step 2: Find nearby land
  const landBlocks = ['grass_block', 'dirt', 'sand', 'gravel', 'stone', 'cobblestone'];
  let targetLand = null;
  for (const landName of landBlocks) {
    const found = bot.findBlock({
      matching: b => b.name === landName,
      maxDistance: 32
    });
    if (!found) { console.log("Block not found"); return; }
    if (found) {
      targetLand = found;
      break;
    }
  }
  if (targetLand) {
    // Step 3: Move toward the land, slightly above it to walk down
    const targetPos = targetLand.position;
    await moveTo(targetPos.x, targetPos.y + 1, targetPos.z, 1.5, 30);
  } else {
    // No land found, try to move in a direction that might lead to land
    // Check nearby blocks to find a path to shallower water/land
    const checkRadius = 5;
    const botPos = bot.entity.position;
    let bestDirection = null;
    let minWater = Infinity;
    for (let dx = -checkRadius; dx <= checkRadius; dx++) {
      for (let dz = -checkRadius; dz <= checkRadius; dz++) {
        const checkPos = botPos.offset(dx, -1, dz);
        const block = bot.blockAt(checkPos);
        if (block && !block.name.includes('water')) {
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist < minWater) {
            minWater = dist;
            bestDirection = {
              x: dx,
              z: dz
            };
          }
        }
      }
    }
    if (bestDirection) {
      const target = botPos.offset(bestDirection.x * 3, 0, bestDirection.z * 3);
      await moveTo(target.x, target.y + 1, target.z, 1.5, 30);
    }
  }
}