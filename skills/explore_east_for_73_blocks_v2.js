async function explore_east_for_73_blocks(bot) {
  const currentPos = bot.entity.position;
  const targetX = currentPos.x + 73;
  await moveTo(targetX, currentPos.y, currentPos.z, 2, 30);
}