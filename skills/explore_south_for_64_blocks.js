async function explore_south_for_64_blocks(bot) {
  const startZ = bot.entity.position.z;
  const targetZ = startZ + 64;
  await exploreUntil('south', 30, () => {
    if (bot.entity.position.z >= targetZ - 5) return bot.entity.position;
    const ironOre = bot.findBlock({
      matching: block => block.name === 'iron_ore',
      maxDistance: 32
    });
    if (ironOre) return ironOre;
    return null;
  });
  const ironOre = bot.findBlock({
    matching: block => block.name === 'iron_ore',
    maxDistance: 32
  });
  if (!ironOre) {
    console.log("Block not found");
    return;
  }
  await mineBlock('iron_ore', 1);
  await smeltItem('iron_ore', 'coal', 1);
}