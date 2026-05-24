async function mine_the_new_ironingot_deposit(bot) {
  // First swim to surface if drowning
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

  // Find iron_ore nearby (the actual iron ore deposit in the world)
  const ironOre = bot.findBlock({
    matching: block => block.name === 'iron_ore',
    maxDistance: 32
  });
  if (!ironOre) { console.log("Block not found"); return; }
  if (ironOre) {
    await mineBlock('iron_ore', 1);
  } else {
    // Explore to find iron ore if not nearby
    await exploreUntil('north', 20, () => bot.findBlock({
      matching: block => block.name === 'iron_ore',
      maxDistance: 32
    }));
    const foundOre = bot.findBlock({
      matching: block => block.name === 'iron_ore',
      maxDistance: 32
    });
    if (!foundOre) { console.log("Block not found"); return; }
    if (foundOre) {
      await mineBlock('iron_ore', 1);
    }
  }
}