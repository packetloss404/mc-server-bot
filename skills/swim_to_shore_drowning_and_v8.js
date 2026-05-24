async function swimToShoreDrowningAnd(bot) {
  const isHeadSubmerged = () => {
    const eyePos = bot.entity.position.offset(0, bot.entity.eyeHeight, 0);
    const eyeBlock = bot.blockAt(eyePos);
    return eyeBlock && (eyeBlock.name.includes('water') || eyeBlock.name === 'bubble_column');
  };
  const isFeetInFluid = () => {
    const feetBlock = bot.blockAt(bot.entity.position);
    return feetBlock && (feetBlock.name.includes('water') || feetBlock.name === 'bubble_column');
  };

  // First, swim to surface if submerged
  if (isHeadSubmerged() || isFeetInFluid()) {
    bot.setControlState('jump', true);
    bot.setControlState('forward', true);
    bot.setControlState('sprint', true);
    while (isHeadSubmerged() && bot.oxygen > 0) {
      await bot.waitForTicks(5);
    }
    await bot.waitForTicks(15);
    bot.clearControlStates();
  }

  // Find nearby land (grass_block, dirt, sand, or stone above water)
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

  // If land found, move to it
  if (landBlock) {
    await moveTo(landBlock.position.x, landBlock.position.y, landBlock.position.z, 2, 30);
  } else {
    // Explore to find land
    await exploreUntil('north', 30, () => {
      return bot.findBlock({
        matching: b => ['grass_block', 'dirt', 'sand', 'stone', 'cobblestone'].includes(b.name),
        maxDistance: 16
      });
    });
  }
}