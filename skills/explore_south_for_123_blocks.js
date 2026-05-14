async function exploreSouthFor123Blocks(bot) {
  const startX = bot.entity.position.x;
  const startY = bot.entity.position.y;
  const startZ = bot.entity.position.z;
  const targetZ = startZ + 123;

  // Since the goal is to explore, and not a specific block, we will just move to the target Z coordinate.
  // The Y coordinate can be adjusted by moveTo to pathfind over terrain.
  // We specify a range of 2 to allow for slight variations in the final position.
  await moveTo(startX, startY, targetZ, 2, 60); // 60 seconds timeout
}