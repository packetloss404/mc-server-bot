async function mineThreeIronOreAtTarget(bot) {
  const targetPos = {
    x: 946,
    y: 52,
    z: 351
  };
  // Move to the target iron ore location
  await moveTo(targetPos.x, targetPos.y, targetPos.z, 2, 30);
  // Mine 3 iron ore blocks. The primitive mineBlock handles finding the nearest matching blocks.
  await mineBlock('iron_ore', 3);
}