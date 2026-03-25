async function mine3CoalOreAt(bot) {
  await moveTo(935, 58, 339, 3, 60);
  await mineBlock('coal_ore', 3);
}