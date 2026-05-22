async function explore_north_for_73_blocks(bot) {
  const target = bot.entity.position.offset(0, 0, -73);
  await moveTo(target.x, target.y, target.z, 2, 60);
}