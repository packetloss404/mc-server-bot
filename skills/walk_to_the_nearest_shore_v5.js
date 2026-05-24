async function walkToTheNearestShore(bot) {
  // First, swim to surface if drowning
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

  // Find land blocks nearby
  const landBlock = bot.findBlock({
    matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'sand' || b.name === 'stone',
    maxDistance: 32
  });
  if (!landBlock) { console.log("Block not found"); return; }
  if (landBlock) {
    // Move to the land block, standing on top of it
    const targetPos = landBlock.position.offset(0, 1, 0);
    await moveTo(targetPos.x, targetPos.y, targetPos.z, 2, 30);
  } else {
    // Explore to find land
    await exploreUntil('south', 30, () => {
      return bot.findBlock({
        matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'sand',
        maxDistance: 32
      });
    });
    const foundLand = bot.findBlock({
      matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'sand',
      maxDistance: 32
    });
    if (!foundLand) { console.log("Block not found"); return; }
    if (foundLand) {
      const targetPos = foundLand.position.offset(0, 1, 0);
      await moveTo(targetPos.x, targetPos.y, targetPos.z, 2, 30);
    }
  }
}