async function explore_east_for_68_blocks(bot) {
  const startX = bot.entity.position.x;
  const targetX = startX + 68;
  const currentY = bot.entity.position.y;
  const currentZ = bot.entity.position.z;

  // Move 68 blocks east
  await moveTo(targetX, currentY, currentZ, 1.5, 60);

  // Search for iron ore nearby after reaching destination
  await bot.waitForTicks(10);
  const ironOre = bot.findBlock({
    matching: b => b.name === 'iron_ore',
    maxDistance: 32
  });
  if (!ironOre) { console.log("Block not found"); return; }
  if (ironOre) {
    // Move to the iron ore
    await moveTo(ironOre.position.x, ironOre.position.y, ironOre.position.z, 3, 30);
  }
}