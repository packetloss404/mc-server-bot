async function walkToTheNearestShore(bot) {
  const isInWater = () => {
    const feetBlock = bot.blockAt(bot.entity.position);
    return feetBlock && feetBlock.name.includes('water');
  };
  const isHeadSubmerged = () => {
    const eyePos = bot.entity.position.offset(0, bot.entity.eyeHeight, 0);
    const eyeBlock = bot.blockAt(eyePos);
    return eyeBlock && eyeBlock.name.includes('water');
  };
  const isOnLand = () => {
    const feetBlock = bot.blockAt(bot.entity.position);
    return feetBlock && (feetBlock.name === 'grass_block' || feetBlock.name === 'dirt' || feetBlock.name === 'sand' || feetBlock.name === 'stone');
  };

  // Already on land
  if (isOnLand() && !isInWater()) return;

  // Swim to surface first if submerged
  if (isHeadSubmerged() || isInWater()) {
    bot.setControlState('jump', true);
    bot.setControlState('forward', true);
    bot.setControlState('sprint', true);
    const startTime = Date.now();
    while (Date.now() - startTime < 15000) {
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
  if (!landBlock) return;

  // Calculate direction to land and swim toward it
  const target = landBlock.position;
  const current = bot.entity.position;

  // Use moveTo with direct control state to swim
  bot.setControlState('forward', true);
  bot.setControlState('sprint', true);
  const startTime = Date.now();
  while (Date.now() - startTime < 20000) {
    await bot.waitForTicks(5);

    // Check if we're on land now
    if (isOnLand() && !isInWater()) {
      bot.clearControlStates();
      return;
    }

    // If head submerged again, swim up
    if (isHeadSubmerged()) {
      bot.setControlState('jump', true);
      await bot.waitForTicks(20);
      bot.setControlState('jump', false);
    }

    // Recalculate direction toward land
    const pos = bot.entity.position;
    const dx = target.x - pos.x;
    const dz = target.z - pos.z;
    const yaw = Math.atan2(-dz, dx);
    bot.look(yaw, 0, false);
  }
  bot.clearControlStates();
}