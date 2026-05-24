async function walkToTheNearestShore(bot) {
  // First swim to surface if submerged
  await swimToTheSurfaceDrowning(bot);

  // Now find land blocks nearby
  const landBlock = bot.findBlock({
    matching: b => b.name === "grass_block" || b.name === "dirt" || b.name === "sand" || b.name === "stone",
    maxDistance: 32
  });
  if (!landBlock) { console.log("Block not found"); return; }
  if (landBlock) {
    // Walk to the land block (on top of it)
    await moveTo(landBlock.position.x, landBlock.position.y + 1, landBlock.position.z, 2, 30);
  } else {
    // No land found nearby, try exploring
    const target = await exploreUntil('north', 20, () => {
      return bot.findBlock({
        matching: b => b.name === "grass_block" || b.name === "dirt" || b.name === "sand",
        maxDistance: 16
      });
    });
    if (target) {
      await moveTo(target.position.x, target.position.y + 1, target.position.z, 2, 30);
    }
  }
}