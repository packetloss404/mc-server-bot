async function explore_north_for_59_blocks(bot) {
  const targetX = bot.entity.position.x;
  const targetZ = bot.entity.position.z - 59;
  const targetY = bot.entity.position.y;
  await exploreUntil('north', 15, () => {
    return bot.findBlock({
      matching: b => b.name === 'iron_ore',
      maxDistance: 32
    });
  });
  await moveTo(targetX, targetY, targetZ, 2, 30);
}