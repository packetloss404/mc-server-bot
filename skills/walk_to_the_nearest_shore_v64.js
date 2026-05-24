async function swimToSurfaceAndWalkToShore(bot) {
  // First, swim to the surface if drowning
  await swimToTheSurfaceDrowning(bot);

  // Now find land (grass_block, dirt, sand, or stone)
  const land = bot.findBlock({
    matching: b => b.name === "grass_block" || b.name === "dirt" || b.name === "sand" || b.name === "stone",
    maxDistance: 32
  });
  if (!land) {
    console.log("No land found nearby");
    return;
  }

  // Move to the land block
  await moveTo(land.position.x, land.position.y, land.position.z, 2, 30);
}