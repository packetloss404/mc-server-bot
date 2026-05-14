async function explore_north_for_50_blocks(bot) {
  const targetPos = bot.entity.position.offset(0, 0, -50);
  await moveTo(targetPos.x, targetPos.y, targetPos.z, 2, 120);
}