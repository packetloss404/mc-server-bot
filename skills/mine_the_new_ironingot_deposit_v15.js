async function mine_the_new_ironingot_deposit(bot) {
  // First swim to surface if submerged
  const isHeadSubmerged = () => {
    const eyePos = bot.entity.position.offset(0, bot.entity.eyeHeight, 0);
    const eyeBlock = bot.blockAt(eyePos);
    return eyeBlock && (eyeBlock.name.includes('water') || eyeBlock.name.includes('lava') || eyeBlock.name === 'bubble_column');
  };
  if (isHeadSubmerged()) {
    await swimToTheSurfaceDrowning(bot);
  }

  // Find iron_ore nearby
  const ironOre = bot.findBlock({
    matching: b => b.name === 'iron_ore',
    maxDistance: 32
  });
  if (!ironOre) {
    // Explore to find iron ore
    const target = await exploreUntil('north', 30, () => bot.findBlock({
      matching: b => b.name === 'iron_ore',
      maxDistance: 32
    }));
    if (target) {
      await mineBlock('iron_ore', 1);
    }
  } else {
    await mineBlock('iron_ore', 1);
  }
}