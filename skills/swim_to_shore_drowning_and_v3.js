async function swimToShoreDrowningAnd(bot) {
  // First, swim to the surface if submerged
  const isHeadSubmerged = () => {
    const eyePos = bot.entity.position.offset(0, bot.entity.eyeHeight, 0);
    const eyeBlock = bot.blockAt(eyePos);
    return eyeBlock && (eyeBlock.name.includes('water') || eyeBlock.name === 'bubble_column');
  };
  if (isHeadSubmerged()) {
    bot.setControlState('jump', true);
    bot.setControlState('forward', true);
    bot.setControlState('sprint', true);
    while (isHeadSubmerged()) {
      await bot.waitForTicks(5);
    }
    await bot.waitForTicks(10);
    bot.clearControlStates();
  }

  // Find land nearby
  const land = bot.findBlock({
    matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'sand' || b.name === 'stone',
    maxDistance: 32
  });
  if (!land) { console.log("Block not found"); return; }
  if (land) {
    await moveTo(land.position.x, land.position.y, land.position.z, 2, 30);
  }
}