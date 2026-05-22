async function explore_north_for_71_blocks(bot) {
  const currentPos = bot.entity.position;
  const targetPos = {
    x: currentPos.x,
    y: currentPos.y,
    z: currentPos.z - 71
  };
  await moveTo(targetPos.x, targetPos.y, targetPos.z, 2, 30);
}