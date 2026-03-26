async function mine3CoalOreAt549(bot) {
  await moveTo(549, 66, 74, 3, 60);
  await mineBlock('coal_ore', 3);
}