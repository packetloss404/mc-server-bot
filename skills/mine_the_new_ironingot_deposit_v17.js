async function mine_the_new_ironingot_deposit(bot) {
  // First swim to surface if underwater
  const eyePos = bot.entity.position.offset(0, bot.entity.eyeHeight, 0);
  const eyeBlock = bot.blockAt(eyePos);
  if (eyeBlock && (eyeBlock.name.includes('water') || eyeBlock.name.includes('lava'))) {
    bot.setControlState('jump', true);
    bot.setControlState('forward', true);
    bot.setControlState('sprint', true);
    while (bot.blockAt(bot.entity.position.offset(0, bot.entity.eyeHeight, 0)).name.includes('water')) {
      await bot.waitForTicks(5);
    }
    bot.clearControlStates();
  }

  // Find iron_ore nearby
  const ironOrePos = bot.findBlock({
    matching: b => b.name === 'iron_ore',
    maxDistance: 32
  });
  if (!ironOrePos) {
    await exploreUntil('south', 30, () => bot.findBlock({
      matching: b => b.name === 'iron_ore',
      maxDistance: 32
    }));
  }

  // Mine iron_ore (iron_ingot_deposit is the ore block)
  await mineBlock('iron_ore', 1);
}