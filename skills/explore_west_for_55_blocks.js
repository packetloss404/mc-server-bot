async function explore_west_for_55_blocks(bot) {
  const targetX = bot.entity.position.x - 55;
  await moveTo(targetX, bot.entity.position.y, bot.entity.position.z, 3, 60);
}