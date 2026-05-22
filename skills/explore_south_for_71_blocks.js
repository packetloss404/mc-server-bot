async function explore_south_for_71_blocks(bot) {
  // Move south 71 blocks from current position (716, 70, 202) to (716, 70, 131)
  const targetX = 716;
  const targetY = 70;
  const targetZ = 202 - 71;
  await moveTo(targetX, targetY, targetZ, 2, 60);
}