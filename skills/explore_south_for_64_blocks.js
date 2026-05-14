async function explore_south_for_64_blocks(bot) {
  const targetZ = bot.entity.position.z - 64;
  await moveTo(bot.entity.position.x, bot.entity.position.y, targetZ, 2, 120);
}