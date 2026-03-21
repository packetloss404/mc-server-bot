async function exploreWest50Blocks(bot) {
  const currentPos = bot.entity.position;
  const targetX = currentPos.x - 50;
  const targetY = currentPos.y;
  const targetZ = currentPos.z;
  await moveTo(targetX, targetY, targetZ, 2, 60);
}