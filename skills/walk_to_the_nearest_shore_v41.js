async function walkToTheNearestShore(bot) {
  // First, swim to the surface if drowning
  await swimToTheSurfaceDrowning(bot);

  // Then find land blocks nearby
  const landBlock = bot.findBlock({
    matching: b => b.name === "grass_block" || b.name === "dirt" || b.name === "sand" || b.name === "stone",
    maxDistance: 32
  });
  if (!landBlock) { console.log("Block not found"); return; }
  if (landBlock) {
    await moveTo(landBlock.position.x, landBlock.position.y, landBlock.position.z, 2, 30);
  }
}