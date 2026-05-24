async function walkToTheNearestShore(bot) {
  const isInWater = () => {
    const eyePos = bot.entity.position.offset(0, bot.entity.eyeHeight, 0);
    const feetBlock = bot.blockAt(bot.entity.position);
    const eyeBlock = bot.blockAt(eyePos);
    return feetBlock && feetBlock.name.includes('water') || eyeBlock && eyeBlock.name.includes('water') || bot.entity.position.y < 62;
  };

  // First swim to surface if submerged
  if (isInWater()) {
    const eyePos = bot.entity.position.offset(0, bot.entity.eyeHeight, 0);
    const eyeBlock = bot.blockAt(eyePos);
    if (eyeBlock && eyeBlock.name.includes('water')) {
      bot.setControlState('jump', true);
      bot.setControlState('forward', true);
      bot.setControlState('sprint', true);
      const startTime = Date.now();
      while (Date.now() - startTime < 15000) {
        await bot.waitForTicks(5);
        const currentEye = bot.entity.position.offset(0, bot.entity.eyeHeight, 0);
        if (!bot.blockAt(currentEye).name.includes('water')) {
          break;
        }
      }
      bot.clearControlStates();
    }
  }

  // Find land blocks
  const landBlock = bot.findBlock({
    matching: b => ['grass_block', 'dirt', 'sand', 'stone', 'gravel', 'cobblestone'].includes(b.name),
    maxDistance: 32
  });
  if (landBlock) {
    const target = landBlock.position;
    await moveTo(target.x, target.y, target.z, 2, 30);

    // Keep moving toward land until no longer in water
    let attempts = 0;
    while (isInWater() && attempts < 10) {
      const nextLand = bot.findBlock({
        matching: b => ['grass_block', 'dirt', 'sand', 'stone', 'gravel', 'cobblestone'].includes(b.name),
        maxDistance: 16
      });
      if (nextLand) {
        await moveTo(nextLand.position.x, nextLand.position.y, nextLand.position.z, 2, 15);
      }
      attempts++;
    }
  }
}