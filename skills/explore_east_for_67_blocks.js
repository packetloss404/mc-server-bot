async function explore_east_for_67_blocks(bot) {
  await swimToTheSurfaceDrowning(bot);
  const target = bot.entity.position.offset(67, 0, 0);
  await moveTo(target.x, target.y, target.z, 2, 60);
}