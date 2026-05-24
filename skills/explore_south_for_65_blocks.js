async function explore_south_for_65_blocks(bot) {
  const startZ = bot.entity.position.z;
  const targetZ = startZ + 65;
  await exploreUntil('south', 30, () => {
    const ironOre = bot.findBlock({
      matching: block => block.name === 'iron_ore',
      maxDistance: 32
    });
    if (!ironOre) { console.log("Block not found"); return; }
    if (ironOre) return ironOre;
    if (bot.entity.position.z >= targetZ - 5) return bot.entity.position;
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
  if (ironOre) {
    await mineBlock('iron_ore', 1);
    await smeltItem('iron_ore', 'coal', 1);
  }
}