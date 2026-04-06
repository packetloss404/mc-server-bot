async function mineCoalOreAt952(bot) {
  const targetPos = {
    x: 952,
    y: 56,
    z: 344
  };
  await moveTo(targetPos.x, targetPos.y, targetPos.z, 2, 30);
  await mineBlock('coal_ore', 1);
}