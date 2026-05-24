async function explore_north_for_222_blocks(bot) {
  // Explore north in segments: 70 + 70 + 70 + 12 (remainder)
  await explore_north_for_70_blocks(bot);
  await explore_north_for_70_blocks(bot);
  await explore_north_for_70_blocks(bot);

  // Explore remaining 12 blocks north
  const pos = bot.entity.position;
  await moveTo(pos.x, pos.y, pos.z - 12, 2, 15);

  // Check for iron ingot nearby
  const ingot = bot.findBlock({
    matching: b => b.name === 'iron_ingot',
    maxDistance: 16
  });
  if (!ingot) { console.log("Block not found"); return; }
  if (ingot) {
    await mineBlock('iron_ingot', 1);
  }
}