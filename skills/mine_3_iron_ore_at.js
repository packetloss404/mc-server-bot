async function mineThreeIronOreAtSpecifiedLocation(bot) {
  const targetX = 905;
  const targetY = 63;
  const targetZ = 258;
  await moveTo(targetX, targetY, targetZ, 3, 60);
  await mineBlock('iron_ore', 3);
}