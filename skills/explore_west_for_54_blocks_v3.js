async function explore_west_for_54_blocks(bot) {
  const targetX = bot.entity.position.x - 54;
  await moveTo(targetX, bot.entity.position.y, bot.entity.position.z, 2, 30);
}