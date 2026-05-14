async function mineTheCopperOreAt97455156(bot) {
  const targetX = 974;
  const targetY = 55;
  const targetZ = 156;

  // Move to the target location
  await moveTo(targetX, targetY, targetZ, 1, 60);

  // Mine the copper_ore
  await mineBlock('copper_ore', 1);
}