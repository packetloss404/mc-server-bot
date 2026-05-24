async function walkToTheNearestShore(bot) {
  const isInWater = () => {
    const feetBlock = bot.blockAt(bot.entity.position);
    return feetBlock && (feetBlock.name.includes('water') || feetBlock.name === 'bubble_column');
  };
  if (!isInWater()) {
    return; // Already on land
  }

  // Find nearby land blocks
  const landBlock = bot.findBlock({
    matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'sand' || b.name === 'stone',
    maxDistance: 32
  });
  if (!landBlock) { console.log("Block not found"); return; }
  if (landBlock) {
    await moveTo(landBlock.position.x, landBlock.position.y, landBlock.position.z, 2, 30);
  } else {
    // Explore to find land
    await exploreUntil('north', 30, () => {
      return bot.findBlock({
        matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'sand',
        maxDistance: 32
      });
    });
  }
}