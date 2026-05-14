async function explore_west_for_75_blocks(bot) {
  const targetX = bot.entity.position.x - 75;
  await moveTo(targetX, bot.entity.position.y, bot.entity.position.z, 2, 120);
}