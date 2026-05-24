async function swimToShoreDrowningAnd(bot) {
  // First swim to the surface
  await swimToTheSurfaceDrowning(bot);

  // Now look for land nearby
  const landBlock = bot.findBlock({
    matching: b => b.name === "grass_block" || b.name === "dirt" || b.name === "sand" || b.name === "stone",
    maxDistance: 32
  });
  if (!landBlock) { console.log("Block not found"); return; }
  if (landBlock) {
    await moveTo(landBlock.position.x, landBlock.position.y, landBlock.position.z, 2, 30);
  } else {
    // If no land found, explore in a spiral to find shore
    const pos = bot.entity.position;
    await exploreUntil('north', 15, () => {
      return bot.findBlock({
        matching: b => b.name === "grass_block" || b.name === "dirt" || b.name === "sand",
        maxDistance: 16
      });
    });
  }
}