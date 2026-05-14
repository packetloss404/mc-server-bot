async function explore_south_for_65_blocks(bot) {
  const targetPos = bot.entity.position.offset(0, 0, 65);
  await moveTo(targetPos.x, targetPos.y, targetPos.z, 2, 60);
}