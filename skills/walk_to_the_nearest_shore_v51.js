async function walkToTheNearestShore(bot) {
  // First swim to surface if drowning
  const isHeadSubmerged = () => {
    const eyePos = bot.entity.position.offset(0, bot.entity.eyeHeight, 0);
    const eyeBlock = bot.blockAt(eyePos);
    return eyeBlock && (eyeBlock.name.includes('water') || eyeBlock.name === 'bubble_column');
  };
  const isFeetInFluid = () => {
    const feetBlock = bot.blockAt(bot.entity.position);
    return feetBlock && (feetBlock.name.includes('water') || feetBlock.name === 'bubble_column');
  };
  if (isHeadSubmerged() || isFeetInFluid()) {
    bot.setControlState('jump', true);
    bot.setControlState('forward', true);
    bot.setControlState('sprint', true);
    const startTime = Date.now();
    while (Date.now() - startTime < 30000) {
      await bot.waitForTicks(5);
      if (!isHeadSubmerged()) {
        await bot.waitForTicks(10);
        break;
      }
    }
    bot.clearControlStates();
  }

  // Wait for momentum to settle
  await bot.waitForTicks(5);

  // Find land blocks - prioritize blocks at or above current water level
  const landTypes = ['grass_block', 'dirt', 'sand', 'stone', 'cobblestone', 'gravel'];
  let landBlock = null;
  for (const landType of landTypes) {
    const found = bot.findBlock({
      matching: b => b.name === landType,
      maxDistance: 32
    });
    if (!found) { console.log("Block not found"); return; }
    if (found) {
      landBlock = found;
      break;
    }
  }
  if (!landBlock) {
    // Fallback: explore in cardinal directions to find land
    const directions = [{
      x: 1,
      z: 0
    }, {
      x: -1,
      z: 0
    }, {
      x: 0,
      z: 1
    }, {
      x: 0,
      z: -1
    }, {
      x: 1,
      z: 1
    }, {
      x: -1,
      z: -1
    }, {
      x: 1,
      z: -1
    }, {
      x: -1,
      z: 1
    }];
    for (const dir of directions) {
      const targetPos = bot.entity.position.offset(dir.x * 5, 0, dir.z * 5);
      await moveTo(targetPos.x, targetPos.y, targetPos.z, 1, 10);
      await bot.waitForTicks(10);

      // Check if we're on land now
      const feetBlock = bot.blockAt(bot.entity.position);
      if (feetBlock && !feetBlock.name.includes('water') && feetBlock.name !== 'bubble_column') {
        return; // Successfully reached land
      }
    }
    return;
  }

  // Move to the land block - approach from a direction that allows walking onto it
  const targetPos = landBlock.position;
  const botPos = bot.entity.position;

  // Calculate horizontal direction to land
  const dx = targetPos.x - botPos.x;
  const dz = targetPos.z - botPos.z;

  // Move towards and slightly onto the land
  await moveTo(targetPos.x + 0.5, targetPos.y + 1, targetPos.z + 0.5, 0.5, 30);

  // If still in water, try moving forward to get onto land
  await bot.waitForTicks(5);
  const currentBlock = bot.blockAt(bot.entity.position);
  if (currentBlock && currentBlock.name.includes('water')) {
    bot.setControlState('forward', true);
    bot.setControlState('sprint', true);
    await bot.waitForTicks(20);
    bot.clearControlStates();
  }
}