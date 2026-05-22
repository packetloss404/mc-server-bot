async function explore_south_for_75_blocks(bot) {
  await exploreUntil('south', 30, () => {
    const ironOre = bot.findBlock({
      matching: b => b.name === 'iron_ore',
      maxDistance: 32
    });
    if (!ironOre) { console.log("Block not found"); return; }
    const deepslateIronOre = bot.findBlock({
      matching: b => b.name === 'deepslate_iron_ore',
      maxDistance: 32
    });
    if (!deepslateIronOre) { console.log("Block not found"); return; }
    return ironOre || deepslateIronOre;
  });
  const targetZ = bot.entity.position.z - 75;
  if (bot.entity.position.z > targetZ + 5) {
    await moveTo(bot.entity.position.x, bot.entity.position.y, targetZ, 2, 60);
  }
}