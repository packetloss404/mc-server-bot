async function swimToShoreDrowningAndTakingDamage(bot) {
  const isHeadSubmerged = () => {
    const eyePos = bot.entity.position.offset(0, bot.entity.eyeHeight, 0);
    const eyeBlock = bot.blockAt(eyePos);
    return eyeBlock && (eyeBlock.name.includes('water') || eyeBlock.name.includes('lava') || eyeBlock.name === 'bubble_column');
  };

  // First swim to surface if underwater
  if (isHeadSubmerged()) {
    bot.setControlState('jump', true);
    bot.setControlState('forward', true);
    bot.setControlState('sprint', true);
    const startTime = Date.now();
    while (Date.now() - startTime < 30000) {
      await bot.waitForTicks(5);
      if (!isHeadSubmerged()) break;
    }
    bot.clearControlStates();
  }

  // Find nearby land (grass_block, dirt, sand, or stone)
  const landBlock = bot.findBlock({
    matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'sand' || b.name === 'stone',
    maxDistance: 32
  });
  if (!landBlock) { console.log("Block not found"); return; }
  if (landBlock) {
    await moveTo(landBlock.position.x, landBlock.position.y, landBlock.position.z, 2, 30);
  }
}