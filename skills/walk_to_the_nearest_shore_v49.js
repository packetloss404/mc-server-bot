async function walkToTheNearestShore(bot) {
  // First swim to the surface using the existing skill
  await swimToTheSurfaceDrowning(bot);

  // Find nearby land (grass_block, dirt, sand, or stone)
  const landBlock = bot.findBlock({
    matching: b => b.name === "grass_block" || b.name === "dirt" || b.name === "sand" || b.name === "stone",
    maxDistance: 32
  });
  if (!landBlock) { console.log("Block not found"); return; }
  if (landBlock) {
    // Walk to the land position
    await moveTo(landBlock.position.x, landBlock.position.y, landBlock.position.z, 2, 30);
  }
}