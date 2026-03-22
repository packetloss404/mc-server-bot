async function mineThreeIronOreAtCurrentTarget(bot) {
  const targetX = 811;
  const targetY = 42;
  const targetZ = 238;
  await moveTo(targetX, targetY, targetZ, 2, 60);
  await mineBlock('iron_ore', 3);
}