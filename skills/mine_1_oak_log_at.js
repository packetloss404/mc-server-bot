async function mine1OakLogAt(bot) {
  const targetPos = {
    x: 757,
    y: 81,
    z: 287
  };
  await moveTo(targetPos.x, targetPos.y, targetPos.z, 2, 30);
  await mineBlock('oak_log', 1);
}