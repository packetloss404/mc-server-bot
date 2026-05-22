async function walkToTheNearestShore(bot) {
  const isInWater = () => {
    const feetBlock = bot.blockAt(bot.entity.position);
    return feetBlock && feetBlock.name === 'water';
  };
  if (!isInWater()) {
    return; // Not in water, nothing to do
  }

  // First swim to surface if head is submerged
  const eyePos = bot.entity.position.offset(0, bot.entity.eyeHeight, 0);
  const eyeBlock = bot.blockAt(eyePos);
  if (eyeBlock && eyeBlock.name === 'water') {
    bot.setControlState('jump', true);
    bot.setControlState('forward', true);
    bot.setControlState('sprint', true);
    await bot.waitForTicks(20);
    bot.clearControlStates();
  }

  // Find nearby land blocks
  const landTypes = ['grass_block', 'dirt', 'sand', 'stone', 'cobblestone', 'gravel', 'oak_planks', 'spruce_planks', 'birch_planks'];
  const landBlock = bot.findBlock({
    matching: b => landTypes.includes(b.name),
    maxDistance: 32
  });
  if (!landBlock) {
    // Try to find any solid block
    const solidBlock = bot.findBlock({
      matching: b => b.name !== 'water' && b.name !== 'air' && !b.name.includes('water'),
      maxDistance: 32
    });
    if (!solidBlock) return;
    await moveTo(solidBlock.position.x, solidBlock.position.y, solidBlock.position.z, 2, 30);
  } else {
    await moveTo(landBlock.position.x, landBlock.position.y, landBlock.position.z, 2, 30);
  }

  // Keep moving until out of water
  for (let i = 0; i < 20; i++) {
    if (!isInWater()) break;
    const currentPos = bot.entity.position;
    await moveTo(currentPos.x, currentPos.z, 2, 30);
    await bot.waitForTicks(10);
  }
}