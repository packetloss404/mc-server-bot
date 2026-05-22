async function explore_south_for_53_blocks(bot) {
  const targetZ = Math.floor(bot.entity.position.z) + 53;
  await exploreUntil('south', 25, () => {
    const ironIngot = bot.findBlock({
      matching: b => b.name === 'iron_ingot',
      maxDistance: 32
    });
    if (!ironIngot) { console.log("Block not found"); return; }
    if (ironIngot) return ironIngot;
    const ironOre = bot.findBlock({
      matching: b => b.name === 'iron_ore',
      maxDistance: 32
    });
    if (!ironOre) { console.log("Block not found"); return; }
    if (ironOre) return ironOre;
    if (Math.floor(bot.entity.position.z) >= targetZ) {
      return bot.entity.position;
    }
    return null;
  });
}