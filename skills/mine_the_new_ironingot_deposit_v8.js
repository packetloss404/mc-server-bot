async function mine_the_new_ironingot_deposit(bot) {
  // Swim to surface first if submerged
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
    const maxSwimTime = 30000;
    while (Date.now() - startTime < maxSwimTime) {
      await bot.waitForTicks(5);
      if (!isHeadSubmerged()) {
        await bot.waitForTicks(10);
        break;
      }
    }
    bot.clearControlStates();
  }

  // Find iron ore nearby
  const ironOre = bot.findBlock({
    matching: b => b.name === 'iron_ore',
    maxDistance: 32
  });
  if (!ironOre) { console.log("Block not found"); return; }
  if (ironOre) {
    await moveTo(ironOre.position.x, ironOre.position.y, ironOre.position.z, 3, 10);
    await mineBlock('iron_ore', 1);
  } else {
    // Search outward if not found nearby
    const target = await exploreUntil({
      x: 1,
      y: 0,
      z: 0
    }, 20, () => {
      const found = bot.findBlock({
        matching: b => b.name === 'iron_ore',
        maxDistance: 32
      });
      if (!found) { console.log("Block not found"); return; }
      return found ? found.position : null;
    });
    if (target) {
      await moveTo(target.x, target.y, target.z, 3, 10);
      await mineBlock('iron_ore', 1);
    }
  }
}