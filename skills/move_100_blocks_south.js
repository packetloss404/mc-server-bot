async function move100BlocksSouth(bot) {
  const currentPos = bot.entity.position;
  const targetX = currentPos.x;
  const targetY = currentPos.y; // Keep Y coordinate similar to current
  const targetZ = currentPos.z - 100;
  await moveTo(targetX, targetY, targetZ, 1, 60); // 60 seconds timeout
}