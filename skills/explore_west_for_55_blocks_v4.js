async function explore_west_for_55_blocks(bot) {
  await explore_west_for_54_blocks(bot);
  const target = bot.entity.position.offset(-1, 0, 0);
  await moveTo(target.x, target.y, target.z, 1, 10);
}