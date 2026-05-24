async function walkToTheNearestShore(bot) {
  // First swim to the surface if submerged
  const isHeadSubmerged = () => {
    const eyePos = bot.entity.position.offset(0, bot.entity.eyeHeight, 0);
    const eyeBlock = bot.blockAt(eyePos);
    return eyeBlock && (eyeBlock.name.includes('water') || eyeBlock.name.includes('lava') || eyeBlock.name === 'bubble_column');
  };
  const isFeetInFluid = () => {
    const feetBlock = bot.blockAt(bot.entity.position);
    return feetBlock && (feetBlock.name.includes('water') || feetBlock.name.includes('lava') || feetBlock.name === 'bubble_column');
  };
  if (isHeadSubmerged() || isFeetInFluid()) {
    bot.setControlState('jump', true);
    bot.setControlState('forward', true);
    bot.setControlState('sprint', true);
    const startTime = Date.now();
    const maxSwimTime = 30000;
    while (Date.now() - startTime < maxSwimTime) {
      await bot.waitForTicks(5);
      if (!isHeadSubmerged()) {
        await bot.waitForTicks(10);
        break;
      }
    }
    bot.clearControlStates();
  }

  // Find nearby land blocks
  const landBlockNames = ['grass_block', 'dirt', 'sand', 'stone', 'oak_log', 'birch_log', 'spruce_log', 'gravel'];
  let landBlock = null;
  for (const name of landBlockNames) {
    const found = bot.findBlock({
      matching: b => b.name === name,
      maxDistance: 32
    });
    if (!found) { console.log("Block not found"); return; }
    if (found) {
      landBlock = found;
      break;
    }
  }
  if (landBlock) {
    const targetPos = landBlock.position;
    // Move to the land block (slightly above to avoid digging)
    await moveTo(targetPos.x, targetPos.y + 1, targetPos.z, 2, 30);
  } else {
    // Fallback: explore to find land
    const directions = [{
      x: 5,
      z: 0
    }, {
      x: -5,
      z: 0
    }, {
      x: 0,
      z: 5
    }, {
      x: 0,
      z: -5
    }, {
      x: 10,
      z: 0
    }, {
      x: -10,
      z: 0
    }, {
      x: 0,
      z: 10
    }, {
      x: 0,
      z: -10
    }];
    for (const dir of directions) {
      const targetX = bot.entity.position.x + dir.x;
      const targetZ = bot.entity.position.z + dir.z;
      const blockBelow = bot.blockAt({
        x: targetX,
        y: bot.entity.position.y - 1,
        z: targetZ
      });
      if (blockBelow && (blockBelow.name === 'grass_block' || blockBelow.name === 'dirt' || blockBelow.name === 'sand' || blockBelow.name === 'stone')) {
        await moveTo(targetX, bot.entity.position.y, targetZ, 2, 30);
        return;
      }
    }
  }
}