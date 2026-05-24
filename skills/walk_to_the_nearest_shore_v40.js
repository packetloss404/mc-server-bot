async function walkToTheNearestShore(bot) {
  // First, swim to the surface if submerged
  await swimToTheSurfaceDrowning(bot);

  // Find the nearest land block
  const landBlock = bot.findBlock({
    matching: b => b.name === "grass_block" || b.name === "dirt" || b.name === "sand" || b.name === "stone",
    maxDistance: 32
  });
  if (!landBlock) { console.log("Block not found"); return; }
  if (landBlock) {
    await moveTo(landBlock.position.x, landBlock.position.y, landBlock.position.z, 2, 30);
  } else {
    // Explore to find land
    await exploreUntil('north', 15, () => {
      return bot.findBlock({
        matching: b => b.name === "grass_block" || b.name === "dirt" || b.name === "sand",
        maxDistance: 16
      });
    });
    // Try again after exploring
    const found = bot.findBlock({
      matching: b => b.name === "grass_block" || b.name === "dirt" || b.name === "sand",
      maxDistance: 32
    });
    if (!found) { console.log("Block not found"); return; }
    if (found) {
      await moveTo(found.position.x, found.position.y, found.position.z, 2, 30);
    }
  }
}