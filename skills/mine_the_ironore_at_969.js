async function mineIronOreAtTarget(bot) {
  await moveTo(969, 59, 373, 2, 60);
  await mineBlock('iron_ore', 1);
}