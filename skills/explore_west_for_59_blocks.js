async function explore_west_for_59_blocks(bot) {
  await explore_west_for_54_blocks(bot);
  const target = bot.entity.position.offset(-5, 0, 0);
  await moveTo(target.x, target.y, target.z, 2, 15);
}