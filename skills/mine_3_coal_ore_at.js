async function mine3CoalOreAt(bot) {
  const coalOrePos = {
    x: 995,
    y: 49,
    z: 360
  };
  await moveTo(coalOrePos.x, coalOrePos.y, coalOrePos.z, 2, 60);
  await mineBlock('coal_ore', 3);
}