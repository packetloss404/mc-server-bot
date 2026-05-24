async function walkToTheNearestShore(bot) {
  // First swim to the surface if drowning
  await swimToTheSurfaceDrowning(bot);

  // Now find land blocks
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
        matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'sand' || b.name === 'stone',
        maxDistance: 32
      });
    });

    // Try to move to the found land
    const foundLand = bot.findBlock({
      matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'sand' || b.name === 'stone',
      maxDistance: 32
    });
    if (!foundLand) { console.log("Block not found"); return; }
    if (foundLand) {
      await moveTo(foundLand.position.x, foundLand.position.y, foundLand.position.z, 2, 30);
    }
  }
}