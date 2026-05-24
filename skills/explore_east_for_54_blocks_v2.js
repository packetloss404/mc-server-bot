async function explore_east_for_54_blocks(bot) {
  const currentPos = bot.entity.position;
  const targetX = currentPos.x + 54;
  await moveTo(targetX, currentPos.y, currentPos.z, 2, 30);
}