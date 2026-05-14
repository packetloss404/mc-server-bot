async function explore_south_for_60_blocks(bot) {
  // Move 60 blocks south from current position (z axis)
  const target = bot.entity.position.offset(0, 0, 60);
  await moveTo(target.x, target.y, target.z, 3, 60);
}