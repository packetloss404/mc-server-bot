async function explore_south_for_63_blocks(bot) {
  const targetZ = bot.entity.position.z - 63;
  await exploreUntil('south', 30, () => {
    const ironOre = bot.findBlock({
      matching: block => block.name === 'iron_ore',
      maxDistance: 32
    });
    if (!ironOre) { console.log("Block not found"); return; }
    if (ironOre) return ironOre;
    return null;
  });
}