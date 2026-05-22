async function explore_north_for_55_blocks(bot) {
  const target = bot.entity.position.offset(0, 0, -55);
  await moveTo(target.x, target.y, target.z, 2, 30);
}