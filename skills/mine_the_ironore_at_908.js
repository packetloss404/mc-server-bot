async function mineIronOreAtTarget(bot) {
  await moveTo(908, 52, 389, 3, 60);
  await mineBlock('iron_ore', 1);
}