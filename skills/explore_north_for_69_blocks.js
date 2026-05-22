async function explore_north_for_69_blocks(bot) {
  const targetZ = bot.entity.position.z - 69;
  await moveTo(bot.entity.position.x, bot.entity.position.y, targetZ, 2, 60);
}