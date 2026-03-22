async function mineThreeCoalOreAtLocation(bot) {
  const targetX = 911;
  const targetY = 66;
  const targetZ = 254;
  await moveTo(targetX, targetY, targetZ, 3, 60);
  await mineBlock('coal_ore', 3);
}