async function swimToTheSurfaceDrowning(bot) {
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
    const maxSwimTime = 30000; // 30 seconds safety limit

    while (Date.now() - startTime < maxSwimTime) {
      await bot.waitForTicks(5);
      if (!isHeadSubmerged()) {
        await bot.waitForTicks(10); // Ensure clear of surface
        break;
      }
    }
    bot.clearControlStates();
  }
}