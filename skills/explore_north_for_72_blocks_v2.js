async function explore_north_for_72_blocks(bot) {
  await explore_north_for_70_blocks(bot);
  const pos = bot.entity.position;
  await moveTo(pos.x, pos.y, pos.z - 2, 2, 10);
}