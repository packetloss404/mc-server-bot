async function explore_east_for_59_blocks(bot) {
  const targetX = bot.entity.position.x + 59;
  await moveTo(targetX, bot.entity.position.y, bot.entity.position.z, 2, 60);
}