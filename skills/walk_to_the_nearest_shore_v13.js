async function walkToTheNearestShore(bot) {
  const isHeadSubmerged = () => {
    const eyePos = bot.entity.position.offset(0, bot.entity.eyeHeight, 0);
    const eyeBlock = bot.blockAt(eyePos);
    return eyeBlock && (eyeBlock.name.includes('water') || eyeBlock.name.includes('lava') || eyeBlock.name === 'bubble_column');
  };
  const isFeetInFluid = () => {
    const feetBlock = bot.blockAt(bot.entity.position);
    return feetBlock && (feetBlock.name.includes('water') || feetBlock.name.includes('lava') || feetBlock.name === 'bubble_column');
  };

  // Swim to surface if submerged
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
  const landBlock = bot.findBlock({
    matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'sand' || b.name === 'stone',
    maxDistance: 32
  });
  if (!landBlock) { console.log("Block not found"); return; }
  if (landBlock) {
    await moveTo(landBlock.position.x, landBlock.position.y, landBlock.position.z, 2, 30);
  } else {
    // Explore in all directions to find land
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
      const target = bot.entity.position.offset(dir.x * 5, 0, dir.z * 5);
      await moveTo(target.x, target.y, target.z, 2, 10);
      const foundLand = bot.findBlock({
        matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'sand',
        maxDistance: 32
      });
      if (!foundLand) { console.log("Block not found"); return; }
      if (foundLand) {
        await moveTo(foundLand.position.x, foundLand.position.y, foundLand.position.z, 2, 30);
        break;
      }
    }
  }
}