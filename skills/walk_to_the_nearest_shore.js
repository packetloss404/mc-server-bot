async function walkToTheNearestShore(bot) {
  // Find nearby land block
  const landBlock = bot.findBlock({
    matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'sand' || b.name === 'stone',
    maxDistance: 32
  });
  if (!landBlock) { console.log("Block not found"); return; }
  if (landBlock) {
    // Move to the land block
    await moveTo(landBlock.position.x, landBlock.position.y, landBlock.position.z, 2, 30);
  } else {
    // If no land block found nearby, swim to surface first
    await swimToTheSurfaceDrowning(bot);
    // Then try again to find land
    const landBlockAfterSurface = bot.findBlock({
      matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'sand' || b.name === 'stone',
      maxDistance: 32
    });
    if (!landBlockAfterSurface) { console.log("Block not found"); return; }
    if (landBlockAfterSurface) {
      await moveTo(landBlockAfterSurface.position.x, landBlockAfterSurface.position.y, landBlockAfterSurface.position.z, 2, 30);
    }
  }
}