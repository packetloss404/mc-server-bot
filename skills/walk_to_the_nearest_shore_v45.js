async function walkToTheNearestShore(bot) {
  // First, swim to the surface if submerged
  await swimToTheSurfaceDrowning(bot);

  // Now find nearby land
  const land = bot.findBlock({
    matching: b => b.name === "grass_block" || b.name === "dirt" || b.name === "sand" || b.name === "stone",
    maxDistance: 32
  });
  if (!land) { console.log("Block not found"); return; }
  if (land) {
    await moveTo(land.position.x, land.position.y, land.position.z, 2, 30);
  }
}