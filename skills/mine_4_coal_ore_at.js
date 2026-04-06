async function mine4CoalOreAtTarget(bot) {
  const coalOrePos = {
    x: 944,
    y: 49,
    z: 355
  };
  await moveTo(coalOrePos.x, coalOrePos.y, coalOrePos.z, 2, 60);
  await mineBlock('coal_ore', 4);
}