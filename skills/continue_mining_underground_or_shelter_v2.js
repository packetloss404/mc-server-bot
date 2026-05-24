async function continueMiningUndergroundOrShelter(bot) {
  // Check if bot is drowning or submerged in water
  const isHeadSubmerged = () => {
    const eyePos = bot.entity.position.offset(0, bot.entity.eyeHeight, 0);
    const eyeBlock = bot.blockAt(eyePos);
    return eyeBlock && (eyeBlock.name.includes('water') || eyeBlock.name === 'bubble_column');
  };
  const isFeetInFluid = () => {
    const feetBlock = bot.blockAt(bot.entity.position);
    return feetBlock && (feetBlock.name.includes('water') || feetBlock.name === 'bubble_column');
  };

  // If drowning or in water, swim to surface first
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
    return; // Stay at surface after swimming
  }

  // Continue mining underground - find nearby ore
  const coalOre = bot.findBlock({
    matching: b => b.name === 'coal_ore',
    maxDistance: 32
  });
  if (!coalOre) { console.log("Block not found"); return; }
  const ironOre = bot.findBlock({
    matching: b => b.name === 'iron_ore',
    maxDistance: 32
  });
  if (!ironOre) { console.log("Block not found"); return; }
  const targetOre = ironOre || coalOre;
  if (targetOre) {
    await mineBlock(targetOre.name, 1);
  } else {
    // No ore nearby, explore to find more resources
    await exploreUntil('north', 15, () => {
      return bot.findBlock({
        matching: b => b.name === 'coal_ore' || b.name === 'iron_ore',
        maxDistance: 16
      });
    });
    const newOre = bot.findBlock({
      matching: b => b.name === 'coal_ore' || b.name === 'iron_ore',
      maxDistance: 16
    });
    if (!newOre) { console.log("Block not found"); return; }
    if (newOre) {
      await mineBlock(newOre.name, 1);
    }
  }
}