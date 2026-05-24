async function walkToTheNearestShore(bot) {
  // First, swim to the surface if submerged
  await swimToTheSurfaceDrowning(bot);
  await bot.waitForTicks(5);

  // Find the nearest land block
  const landBlock = bot.findBlock({
    matching: b => b.name === "grass_block" || b.name === "dirt" || b.name === "sand" || b.name === "stone",
    maxDistance: 32
  });
  if (!landBlock) {
    console.log("Land not found nearby");
    return;
  }
  await moveTo(landBlock.position.x, landBlock.position.y, landBlock.position.z, 2, 30);
}