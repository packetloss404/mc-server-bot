async function explore_north_for_74_blocks(bot) {
  const startX = Math.floor(bot.entity.position.x);
  const startY = bot.entity.position.y;
  const startZ = Math.floor(bot.entity.position.z);
  const targetZ = startZ + 74;
  const stepSize = 15;
  let currentZ = startZ;
  while (currentZ < targetZ) {
    const nextZ = Math.min(currentZ + stepSize, targetZ);
    try {
      await moveTo(startX, startY, nextZ, 2, 50);
      currentZ = nextZ;
    } catch {
      await exploreUntil('north', 20, () => null);
      const newPos = bot.entity.position;
      currentZ = Math.floor(newPos.z);
    }
  }
}