async function walkToTheNearestShore(bot) {
  // First swim to the surface
  await swimToTheSurfaceDrowning(bot);

  // Find land nearby (grass_block, dirt, sand, or stone)
  const land = bot.findBlock({
    matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'sand' || b.name === 'stone',
    maxDistance: 32
  });
  if (!land) { console.log("Block not found"); return; }
  if (land) {
    await moveTo(land.position.x, land.position.y, land.position.z, 2, 30);
  } else {
    // If no land found, explore until we find some
    await exploreUntil('east', 15, () => {
      return bot.findBlock({
        matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'sand' || b.name === 'stone',
        maxDistance: 16
      });
    });
  }
}