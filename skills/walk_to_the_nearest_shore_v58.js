async function swimToTheSurfaceAndWalkToShore(bot) {
  // Step 1: Swim to the surface if in water
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

  // Step 2: Find nearby land (grass_block, dirt, sand, or stone)
  const landBlock = bot.findBlock({
    matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'sand' || b.name === 'stone',
    maxDistance: 32
  });
  if (!landBlock) { console.log("Block not found"); return; }
  if (landBlock) {
    await moveTo(landBlock.position.x, landBlock.position.y, landBlock.position.z, 2, 30);
  } else {
    // Explore in spiral pattern to find land
    await exploreUntil('east', 15, () => {
      return bot.findBlock({
        matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'sand' || b.name === 'stone',
        maxDistance: 16
      });
    });

    // Try again to find land after exploring
    const foundLand = bot.findBlock({
      matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'sand' || b.name === 'stone',
      maxDistance: 32
    });
    if (!foundLand) { console.log("Block not found"); return; }
    if (foundLand) {
      await moveTo(foundLand.position.x, foundLand.position.y, foundLand.position.z, 2, 30);
    }
  }
}