async function mineIronOreAtTarget(bot) {
  const targetPos = {
    x: 984,
    y: 62,
    z: 366
  };
  await moveTo(targetPos.x, targetPos.y, targetPos.z, 2, 30);
  await mineBlock('iron_ore', 1);
}