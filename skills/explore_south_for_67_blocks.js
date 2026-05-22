async function explore_south_for_67_blocks(bot) {
  const targetZ = bot.entity.position.z - 67;
  await moveTo(bot.entity.position.x, bot.entity.position.y, targetZ, 2, 60);
}