async function explore_east_for_64_blocks(bot) {
  const target = bot.entity.position.offset(64, 0, 0);
  await moveTo(target.x, target.y, target.z, 2, 120);
}