async function explore_south_for_69_blocks(bot) {
  const targetPos = bot.entity.position.offset(0, 0, -69);
  await moveTo(targetPos.x, targetPos.y, targetPos.z, 2, 60);
}