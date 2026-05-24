async function walkToTheNearestShore(bot) {
  const isHeadSubmerged = () => {
    const eyePos = bot.entity.position.offset(0, bot.entity.eyeHeight, 0);
    const eyeBlock = bot.blockAt(eyePos);
    return eyeBlock && eyeBlock.name.includes('water');
  };
  const isFeetInWater = () => {
    const feetBlock = bot.blockAt(bot.entity.position);
    return feetBlock && feetBlock.name.includes('water');
  };

  // If head is submerged, swim to surface first
  if (isHeadSubmerged()) {
    bot.setControlState('jump', true);
    bot.setControlState('forward', true);
    bot.setControlState('sprint', true);
    while (isHeadSubmerged() && isFeetInWater()) {
      await bot.waitForTicks(5);
    }
    bot.clearControlStates();
    await bot.waitForTicks(10);
  }

  // Find nearby land
  const land = bot.findBlock({
    matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'sand' || b.name === 'stone',
    maxDistance: 32
  });
  if (!land) { console.log("Block not found"); return; }
  if (land) {
    await moveTo(land.position.x, land.position.y, land.position.z, 2, 30);
  }
}