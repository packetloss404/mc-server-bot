async function explore_north_for_66_blocks(bot) {
  const startPos = bot.entity.position;
  const targetPos = {
    x: startPos.x,
    y: startPos.y,
    z: startPos.z - 66
  };
  await moveTo(targetPos.x, targetPos.y, targetPos.z, 2, 60);
}