async function explore_west_for_50_blocks(bot) {
  const targetX = bot.entity.position.x - 50;
  await exploreUntil('west', 25, () => {
    return bot.findBlock({
      matching: b => b.name === 'iron_ore',
      maxDistance: 32
    });
  });
  await moveTo(targetX, bot.entity.position.y, bot.entity.position.z, 2, 30);
}