async function walk_to_the_nearest_shore(bot) {
  // First swim to surface if submerged
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
    while (Date.now() - startTime < 30000) {
      await bot.waitForTicks(5);
      if (!isHeadSubmerged()) {
        await bot.waitForTicks(10);
        break;
      }
    }
    bot.clearControlStates();
  }

  // Find nearest land (not water, not air)
  const landBlock = bot.findBlock({
    matching: b => !b.name.includes('water') && !b.name.includes('lava') && b.name !== 'air' && b.name !== 'bubble_column' && b.type !== 0,
    maxDistance: 32
  });
  if (landBlock) {
    await moveTo(landBlock.position.x, landBlock.position.y + 1, landBlock.position.z, 2, 30);
  }
}