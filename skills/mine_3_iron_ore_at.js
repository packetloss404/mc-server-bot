async function mine3IronOreAt(bot) {
  await moveTo(918, 64, 385, 3, 60);
  await mineBlock('iron_ore', 3);
}