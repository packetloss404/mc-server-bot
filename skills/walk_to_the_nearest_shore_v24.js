async function walkToTheNearestShore(bot) {
  const isInWater = () => {
    const feetBlock = bot.blockAt(bot.entity.position);
    return feetBlock && (feetBlock.name.includes('water') || feetBlock.name === 'bubble_column');
  };

  // Find nearby land using findBlock (singular)
  const landBlock = bot.findBlock({
    matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'sand' || b.name === 'stone',
    maxDistance: 32
  });
  if (!landBlock) { console.log("Block not found"); return; }
  if (landBlock) {
    // Move to the land block
    await moveTo(landBlock.position.x, landBlock.position.y, landBlock.position.z, 2, 30);
  } else {
    // No land found nearby, try swimming in each direction
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
      const targetPos = bot.entity.position.offset(dir.x * 5, 0, dir.z * 5);
      const targetBlock = bot.findBlock({
        matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'sand' || b.name === 'stone',
        maxDistance: 32
      });
      if (!targetBlock) { console.log("Block not found"); return; }
      if (targetBlock) {
        await moveTo(targetBlock.position.x, targetBlock.position.y, targetBlock.position.z, 2, 30);
        break;
      }
    }
  }

  // Ensure bot is out of water
  if (isInWater()) {
    bot.setControlState('jump', true);
    bot.setControlState('forward', true);
    bot.setControlState('sprint', true);
    await bot.waitForTicks(40);
    bot.clearControlStates();
  }
}