async function move50BlocksNorth(bot) {
  const currentPos = bot.entity.position;
  const targetX = currentPos.x;
  const targetY = currentPos.y;
  const targetZ = currentPos.z - 50; // North is negative Z in Minecraft

  await moveTo(targetX, targetY, targetZ, 1, 60); // Move to the target with a range of 1 block and a 60-second timeout
}