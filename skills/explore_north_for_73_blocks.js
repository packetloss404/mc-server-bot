async function explore_north_for_73_blocks(bot) {
  const targetPos = bot.entity.position.offset(0, 0, -73);
  await moveTo(targetPos.x, targetPos.y, targetPos.z, 3, 60);
}