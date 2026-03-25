async function mineCoalOreAtCoordinate(bot) {
  await moveTo(906, 56, 394, 3);
  await mineBlock('coal_ore', 1);
}