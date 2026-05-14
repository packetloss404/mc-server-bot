async function mine3OakLogsFrom(bot) {
  const targetX = 1862;
  const targetY = 73;
  const targetZ = -679;
  const count = 3;

  // First, move to the target coordinates
  await moveTo(targetX, targetY, targetZ, 1, 60); // Move within 1 block, timeout 60 seconds

  // Then, find and mine the oak logs
  await mineBlock('oak_log', count);
}