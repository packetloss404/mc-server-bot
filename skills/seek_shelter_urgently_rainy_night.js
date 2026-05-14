async function seek_shelter_urgently_rainy_night(bot) {
  // Explore to find the nearby wooden structure (birch_planks, dark_oak_wood nearby)
  const structure = await exploreUntil('any', 10000, () => {
    const nearbyBlock = bot.findBlock({
      matching: b => b.name === 'birch_planks' || b.name === 'oak_planks' || b.name === 'dark_oak_planks' || b.name === 'oak_log' || b.name === 'birch_log' || b.name === 'dark_oak_log' || b.name === 'stripped_dark_oak_wood',
      maxDistance: 16
    });
    if (!nearbyBlock) { console.log("Block not found"); return; }
    return nearbyBlock ? {
      x: nearbyBlock.position.x,
      y: nearbyBlock.position.y,
      z: nearbyBlock.position.z
    } : null;
  });
  if (structure) {
    // Move to the structure and stay inside it
    await moveTo(structure.x, structure.y, structure.z, 2, 10);
    return;
  }

  // If no structure found, gather blocks and build emergency shelter
  const pos = bot.entity.position;
  const x = Math.floor(pos.x);
  const y = Math.floor(pos.y);
  const z = Math.floor(pos.z);

  // Find and mine cobblestone or dirt nearby
  const stoneBlock = bot.findBlock({
    matching: b => b.name === 'cobblestone' || b.name === 'stone',
    maxDistance: 8
  });
  if (!stoneBlock) { console.log("Block not found"); return; }
  const dirtBlock = bot.findBlock({
    matching: b => b.name === 'dirt',
    maxDistance: 8
  });
  if (!dirtBlock) { console.log("Block not found"); return; }
  if (stoneBlock) {
    await mineBlock('cobblestone', 20);
  } else if (dirtBlock) {
    await mineBlock('dirt', 20);
  }

  // Build a small 3x3x2 dirt shelter with door opening
  for (let dx = -1; dx <= 1; dx++) {
    await placeItem('dirt', x + dx, y, z + 1);
    await placeItem('dirt', x + dx, y + 1, z + 1);
  }
  for (let dz = 0; dz <= 1; dz++) {
    await placeItem('dirt', x - 1, y, z + dz);
    await placeItem('dirt', x - 1, y + 1, z + dz);
    await placeItem('dirt', x + 1, y, z + dz);
    await placeItem('dirt', x + 1, y + 1, z + dz);
  }
  await placeItem('dirt', x, y + 1, z);
  await placeItem('dirt', x, y + 1, z + 1);
}