async function walkToTheNearestShore(bot) {
  // Step 1: Swim to surface if submerged
  await swimToTheSurfaceDrowning(bot);

  // Step 2: Find nearby land using findBlock (singular, not findBlocks)
  const landBlock = bot.findBlock({
    matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'sand' || b.name === 'stone',
    maxDistance: 32
  });
  if (!landBlock) { console.log("Block not found"); return; }
  if (landBlock) {
    await moveTo(landBlock.position.x, landBlock.position.y, landBlock.position.z, 2, 30);
  }
}