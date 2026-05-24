async function walkToTheNearestShore(bot) {
  // First swim to surface if in water
  await swimToTheSurfaceDrowning(bot);

  // Wait a moment for surface detection
  await bot.waitForTicks(10);

  // Find land blocks (grass, dirt, sand, stone)
  const landBlock = bot.findBlock({
    matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'sand' || b.name === 'stone',
    maxDistance: 32
  });
  if (!landBlock) { console.log("Block not found"); return; }
  if (landBlock) {
    await moveTo(landBlock.position.x, landBlock.position.y, landBlock.position.z, 2, 30);
  }
}