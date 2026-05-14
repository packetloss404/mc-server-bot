async function explore_west_for_71_blocks(bot) {
  const target = bot.entity.position.offset(-71, 0, 0);
  await moveTo(target.x, target.y, target.z, 2, 60);
}