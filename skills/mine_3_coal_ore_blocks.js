async function mineThreeCoalOreAtTarget(bot) {
  const targetX = 807;
  const targetY = 51;
  const targetZ = 226;
  await moveTo(targetX, targetY, targetZ, 3, 60);
  await mineBlock('coal_ore', 3);
}