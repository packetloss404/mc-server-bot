async function swimToShoreDrowningAnd(bot) {
  // First, swim to the surface if the bot's head is underwater
  const isHeadSubmerged = () => {
    const eyePos = bot.entity.position.offset(0, bot.entity.eyeHeight, 0);
    const eyeBlock = bot.blockAt(eyePos);
    return eyeBlock && (eyeBlock.name.includes('water') || eyeBlock.name === 'bubble_column');
  };
  const isFeetInFluid = () => {
    const feetBlock = bot.blockAt(bot.entity.position);
    return feetBlock && (feetBlock.name.includes('water') || feetBlock.name === 'bubble_column');
  };

  // Swim up to surface if needed
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

  // Now find land (grass_block, dirt, sand, or stone) to walk to
  const landBlock = bot.findBlock({
    matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'sand' || b.name === 'stone',
    maxDistance: 32
  });
  if (!landBlock) { console.log("Block not found"); return; }
  if (landBlock) {
    // Move to the land block
    await moveTo(landBlock.position.x, landBlock.position.y, landBlock.position.z, 2, 30);
  } else {
    // Explore to find land if none nearby
    await exploreUntil('south', 30, () => bot.findBlock({
      matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'sand' || b.name === 'stone',
      maxDistance: 32
    }));

    // Try to move to found land
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