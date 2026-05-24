async function explore_east_for_63_blocks(bot) {
  const currentPos = bot.entity.position;
  const targetX = currentPos.x + 63;
  await moveTo(targetX, currentPos.y, currentPos.z, 2, 30);
}