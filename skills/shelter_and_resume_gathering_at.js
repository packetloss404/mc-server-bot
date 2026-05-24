async function seekShelterAndSleep(bot) {
  // Check if underwater and swim to surface first
  const eyePos = bot.entity.position.offset(0, bot.entity.eyeHeight, 0);
  const eyeBlock = bot.blockAt(eyePos);
  if (eyeBlock && eyeBlock.name.includes('water')) {
    await swimToTheSurfaceDrowning(bot);
  }

  // Check inventory for dirt/cobblestone
  const inv = bot.inventory.items();
  const dirtCount = inv.find(i => i.name === 'dirt')?.count || 0;
  const cobbleCount = inv.find(i => i.name === 'cobblestone')?.count || 0;
  const blockCount = dirtCount + cobbleCount;

  // Gather dirt if needed (need 10-20 for shelter)
  if (blockCount < 15) {
    const needed = 15 - blockCount;
    await mineBlock('dirt', needed);
  }

  // Get current position for shelter placement
  const pos = bot.entity.position;
  const floorY = Math.floor(pos.y);

  // Build a 3x3x3 shelter centered around bot's current position
  // Place blocks at floor level (y = floorY) and walls (y = floorY+1, floorY+2)
  // Leave door opening on one side

  const shelterBlocks = [];
  const startX = Math.floor(pos.x) - 1;
  const startZ = Math.floor(pos.z) - 1;

  // Floor and walls (3x3x3 box with door opening)
  for (let dx = 0; dx <= 2; dx++) {
    for (let dz = 0; dz <= 2; dz++) {
      // Floor at y = floorY (but don't place under bot)
      const floorX = startX + dx;
      const floorZ = startZ + dz;
      if (!(dx === 1 && dz === 1)) {
        // Skip center (where bot stands)
        shelterBlocks.push({
          x: floorX,
          y: floorY,
          z: floorZ
        });
      }
    }
  }

  // Walls at y = floorY+1 and y = floorY+2
  for (let y = floorY + 1; y <= floorY + 2; y++) {
    for (let dx = 0; dx <= 2; dx++) {
      for (let dz = 0; dz <= 2; dz++) {
        // Only place on perimeter (not floor area inside)
        const isEdge = dx === 0 || dx === 2 || dz === 0 || dz === 2;
        if (isEdge) {
          // Door opening: skip one block at y=floorY+1 on one side
          const isDoor = dx === 1 && dz === 0 && y === floorY + 1;
          if (!isDoor) {
            shelterBlocks.push({
              x: startX + dx,
              y: y,
              z: startZ + dz
            });
          }
        }
      }
    }
  }

  // Place blocks using inventory (prefer dirt, use cobblestone if needed)
  for (const block of shelterBlocks) {
    const currentInv = bot.inventory.items();
    const dirt = currentInv.find(i => i.name === 'dirt');
    const cobble = currentInv.find(i => i.name === 'cobblestone');
    const blockToUse = dirt || cobble;
    if (blockToUse) {
      try {
        await placeItem(blockToUse.name, block.x, block.y, block.z);
        await bot.waitForTicks(3);
      } catch (e) {
        // Block may be unreachable, continue
      }
    }
  }

  // Wait for evening/night, then sleep
  await bot.waitForTicks(100);

  // Check if we can sleep (bed nearby)
  const bed = bot.findBlock({
    matching: b => b.name.includes('bed'),
    maxDistance: 5
  });
  if (bed) {
    await bot.sleep();
  }
}