async function explore_north_for_67_blocks(bot) {
  const currentPos = bot.entity.position;
  const targetX = Math.floor(currentPos.x);
  const targetY = Math.floor(currentPos.y);
  const targetZ = Math.floor(currentPos.z) - 67;
  await moveTo(targetX, targetY, targetZ, 3, 60);
}