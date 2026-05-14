async function explore_east_for_74_blocks(bot) {
  const currentPos = bot.entity.position;
  const targetX = currentPos.x + 74;
  const targetY = currentPos.y;
  const targetZ = currentPos.z;
  await moveTo(targetX, targetY, targetZ, 2, 120);
}