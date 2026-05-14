async function explore_north_for_57_blocks(bot) {
  const currentPos = bot.entity.position;
  const targetZ = Math.floor(currentPos.z) - 57;
  const targetX = Math.floor(currentPos.x);
  const targetY = Math.floor(currentPos.y);
  await moveTo(targetX, targetY, targetZ, 3, 60);
}