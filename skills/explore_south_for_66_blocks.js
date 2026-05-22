async function explore_south_for_66_blocks(bot) {
  const targetZ = bot.entity.position.z - 66;
  await moveTo(bot.entity.position.x, bot.entity.position.y, targetZ, 2, 30);
}