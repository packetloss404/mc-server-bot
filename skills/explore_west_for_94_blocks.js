async function exploreWestFor94Blocks(bot) {
  const currentX = bot.entity.position.x;
  const currentY = bot.entity.position.y;
  const currentZ = bot.entity.position.z;
  const targetX = currentX - 94; // Move 94 blocks west
  const targetY = currentY; // Keep the same Y level for exploration
  const targetZ = currentZ;
  await moveTo(targetX, targetY, targetZ, 2, 60); // Move to the target X, Y, Z with a range of 2 blocks and a timeout of 60 seconds
}