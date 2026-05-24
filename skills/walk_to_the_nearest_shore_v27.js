async function walk_to_the_nearest_shore(bot) {
  // First, swim to surface if needed
  const isHeadSubmerged = () => {
    const eyePos = bot.entity.position.offset(0, bot.entity.eyeHeight, 0);
    const eyeBlock = bot.blockAt(eyePos);
    return eyeBlock && (eyeBlock.name.includes('water') || eyeBlock.name.includes('lava') || eyeBlock.name === 'bubble_column');
  };
  const isFeetInFluid = () => {
    const feetBlock = bot.blockAt(bot.entity.position);
    return feetBlock && (feetBlock.name.includes('water') || feetBlock.name.includes('lava') || feetBlock.name === 'bubble_column');
  };
  const isOnSolidGround = () => {
    const feetBlock = bot.blockAt(bot.entity.position.offset(0, -1, 0));
    return feetBlock && (feetBlock.name === 'grass_block' || feetBlock.name === 'dirt' || feetBlock.name === 'sand' || feetBlock.name === 'stone' || feetBlock.name === 'gravel');
  };

  // Swim to surface first
  if (isHeadSubmerged()) {
    await bot.look(bot.entity.yaw, -Math.PI / 2); // Look up
    bot.setControlState('jump', true);
    bot.setControlState('forward', true);
    bot.setControlState('sprint', true);
    const startTime = Date.now();
    while (Date.now() - startTime < 10000) {
      await bot.waitForTicks(5);
      if (!isHeadSubmerged()) break;
    }
    bot.clearControlStates();
    await bot.waitForTicks(10);
  }

  // Find nearby land
  const landBlock = bot.findBlock({
    matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'sand' || b.name === 'stone' || b.name === 'gravel',
    maxDistance: 32
  });
  if (!landBlock) {
    // Explore in cardinal directions to find land
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
    }];
    for (const dir of directions) {
      for (let i = 1; i <= 10; i++) {
        const targetPos = bot.entity.position.offset(dir.x * i, 0, dir.z * i);
        const block = bot.blockAt(targetPos);
        if (block && (block.name === 'grass_block' || block.name === 'dirt' || block.name === 'sand')) {
          landBlock = block;
          break;
        }
      }
      if (landBlock) break;
    }
  }
  if (landBlock) {
    // Swim toward land using controls
    const target = landBlock.position;
    const dx = target.x - bot.entity.position.x;
    const dz = target.z - bot.entity.position.z;
    const targetYaw = Math.atan2(-dz, dx);
    await bot.look(targetYaw, 0);
    bot.setControlState('forward', true);
    bot.setControlState('sprint', true);
    const startTime = Date.now();
    const maxSwimTime = 20000;
    while (Date.now() - startTime < maxSwimTime) {
      await bot.waitForTicks(5);
      if (isOnSolidGround()) {
        bot.clearControlStates();
        return;
      }
      // Recalculate direction if needed
      const currDx = target.x - bot.entity.position.x;
      const currDz = target.z - bot.entity.position.z;
      const dist = Math.sqrt(currDx * currDx + currDz * currDz);
      if (dist < 3) {
        bot.clearControlStates();
        return;
      }
    }
    bot.clearControlStates();
  }
}