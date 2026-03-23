async function mineOakLogAtLocation(bot) {
  const targetX = 798;
  const targetY = 70;
  const targetZ = 227;
  await moveTo(targetX, targetY, targetZ, 3, 60);
  await mineBlock('oak_log', 1);
}