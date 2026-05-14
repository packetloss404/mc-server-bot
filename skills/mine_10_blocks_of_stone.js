async function mine10StoneForConstructionMaterials(bot) {
  const stoneBlock = bot.findBlock({
    matching: b => b.name === 'stone',
    maxDistance: 32
  });
  if (!stoneBlock) {
    await exploreUntil(new Vec3(1, 0, 1), 60, () => {
      return bot.findBlock({
        matching: b => b.name === 'stone',
        maxDistance: 32
      });
    });
  }
  // After exploring, try to find it again
  const targetStoneBlock = bot.findBlock({
    matching: b => b.name === 'stone',
    maxDistance: 32
  });
  if (!targetStoneBlock) { console.log("Block not found"); return; }
  if (targetStoneBlock) {
    await mineBlock('stone', 10);
  } else {
    throw new Error("Could not find stone blocks even after exploring.");
  }
}