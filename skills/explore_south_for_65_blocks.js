async function explore_south_for_65_blocks(bot) {
  const targetZ = bot.entity.position.z - 65;
  await exploreUntil('south', 25, () => {
    return bot.findBlock({
      matching: b => b.name === 'iron_ore',
      maxDistance: 5
    });
  });
  // Fallback: move directly to target z if explore didn't reach far enough
  if (bot.entity.position.z > targetZ + 10) {
    await moveTo(bot.entity.position.x, bot.entity.position.y, targetZ, 2, 30);
  }
}