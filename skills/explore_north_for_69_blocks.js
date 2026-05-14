async function explore_north_for_69_blocks(bot) {
  const target = bot.entity.position.offset(0, 0, -69);
  await moveTo(target.x, target.y, target.z, 3, 60);
}