async function explore_west_for_51_blocks(bot) {
  await explore_west_for_54_blocks(bot);
  const targetPos = bot.entity.position.offset(-3, 0, 0);
  await moveTo(targetPos.x, targetPos.y, targetPos.z, 2, 15);
}