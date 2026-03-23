async function mineOneIronOreAt(bot) {
  await moveTo(1744, 34, 437, 3, 30);
  await mineBlock('iron_ore', 1);
}