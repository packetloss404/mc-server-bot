async function explore_east_for_65_blocks(bot) {
  const targetX = bot.entity.position.x + 65;
  const targetY = bot.entity.position.y;
  const targetZ = bot.entity.position.z;
  await moveTo(targetX, targetY, targetZ, 3, 30);

  // Search for iron ore nearby after moving
  const ironOre = bot.findBlock({
    matching: b => b.name === 'iron_ore',
    maxDistance: 16
  });
  if (!ironOre) { console.log("Block not found"); return; }
  if (ironOre) {
    await mineBlock('iron_ore', 1);
  }
}