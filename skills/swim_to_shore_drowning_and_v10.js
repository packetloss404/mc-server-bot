async function swimToShoreDrowningAnd(bot) {
  // Step 1: Swim to surface first
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
  // Step 2: Find land
  const landBlock = bot.findBlock({
    matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'sand' || b.name === 'stone',
    maxDistance: 32
  });
  if (!landBlock) { console.log("Block not found"); return; }
  if (landBlock) {
    await moveTo(landBlock.position.x, landBlock.position.y, landBlock.position.z, 2, 30);
  }
  // Step 3: Verify on land
  const feetBlock = bot.blockAt(bot.entity.position);
  if (feetBlock && feetBlock.name.includes('water')) {
    const nearbyLand = bot.findBlocks({
      matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'sand',
      maxDistance: 16,
      count: 8
    });
    if (nearbyLand.length > 0) {
      const target = nearbyLand[0];
      await moveTo(target.position.x, target.position.y, target.position.z, 2, 20);
    }
  }
}