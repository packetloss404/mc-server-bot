async function continueMiningUndergroundOrShelter(bot) {
  // Check if the bot is drowning or submerged
  const eyePos = bot.entity.position.offset(0, bot.entity.eyeHeight, 0);
  const eyeBlock = bot.blockAt(eyePos);
  const feetBlock = bot.blockAt(bot.entity.position);
  const isSubmerged = eyeBlock && (eyeBlock.name.includes('water') || eyeBlock.name.includes('lava') || eyeBlock.name === 'bubble_column') || feetBlock && (feetBlock.name.includes('water') || feetBlock.name.includes('lava') || feetBlock.name === 'bubble_column');
  if (isSubmerged) {
    // Swim to surface first
    bot.setControlState('jump', true);
    bot.setControlState('forward', true);
    bot.setControlState('sprint', true);
    const startTime = Date.now();
    while (Date.now() - startTime < 30000) {
      await bot.waitForTicks(5);
      const currentEyePos = bot.entity.position.offset(0, bot.entity.eyeHeight, 0);
      const currentEyeBlock = bot.blockAt(currentEyePos);
      if (!currentEyeBlock || !currentEyeBlock.name.includes('water') && !currentEyeBlock.name.includes('lava') && currentEyeBlock.name !== 'bubble_column') {
        await bot.waitForTicks(10);
        break;
      }
    }
    bot.clearControlStates();
  }

  // Now find and mine blocks underground
  const targetBlock = bot.findBlock({
    matching: b => ['stone', 'dirt', 'grass_block', 'cobblestone', 'andesite', 'granite', 'diorite', 'gravel', 'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'redstone_ore', 'lapis_ore', 'emerald_ore'].includes(b.name),
    maxDistance: 16
  });
  if (targetBlock) {
    await mineBlock(targetBlock.name, 1);
  } else {
    // Dig down to find blocks
    const belowHead = bot.blockAt(bot.entity.position.offset(0, 1, 0));
    if (belowHead && belowHead.name !== 'air' && belowHead.name !== 'cave_air' && belowHead.name !== 'void_air') {
      await mineBlock(belowHead.name, 1);
    }
  }
}