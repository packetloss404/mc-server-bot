async function explore_north_for_56_blocks(bot) {
  const target = bot.entity.position.offset(0, 0, -56);
  await moveTo(target.x, target.y, target.z, 3, 60);
}