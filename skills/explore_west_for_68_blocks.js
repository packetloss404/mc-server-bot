async function explore_west_for_68_blocks(bot) {
  await explore_west_for_60_blocks(bot);
  const target = bot.entity.position.offset(-8, 0, 0);
  await moveTo(target.x, target.y, target.z, 2, 15);
}