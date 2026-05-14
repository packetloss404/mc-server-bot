async function findTheNearestWaterSource(bot) {
  // First, ensure we're not drowning
  await swimToTheSurfaceDrowning(bot);

  // From known world memory, the nearest water is at 1626,62,194
  const waterPos = {
    x: 1626,
    y: 62,
    z: 194
  };

  // Move to the water source
  await moveTo(waterPos.x, waterPos.y, waterPos.z, 2, 30);

  // Verify we found water
  const waterBlock = bot.findBlock({
    matching: block => block.name === 'water',
    maxDistance: 5
  });
  if (!waterBlock) { console.log("Block not found"); return; }
  return waterBlock;
}