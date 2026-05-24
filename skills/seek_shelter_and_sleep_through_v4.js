async function seekShelterAndSleepThrough(bot) {
  // Gather 10-20 blocks of dirt for building shelter
  const inv = bot.inventory.items();
  let dirtCount = inv.find(i => i.name === 'dirt')?.count || 0;
  let cobblestoneCount = inv.find(i => i.name === 'cobblestone')?.count || 0;
  const totalBuildingBlocks = dirtCount + cobblestoneCount;
  const neededBlocks = Math.min(18, Math.max(0, 15 - totalBuildingBlocks));
  if (neededBlocks > 0) {
    const dirtNeeded = Math.min(neededBlocks, 18);
    try {
      await mineBlock('dirt', dirtNeeded);
    } catch {
      try {
        await mineBlock('cobblestone', dirtNeeded);
      } catch {
        // Use whatever we have
      }
    }
  }

  // Build 3x3x2 shelter (floor, walls on 3 sides, ceiling)
  const pos = bot.entity.position;
  const x = Math.floor(pos.x);
  const y = Math.floor(pos.y);
  const z = Math.floor(pos.z);

  // Get current building blocks
  const currentInv = bot.inventory.items();
  let blocksToUse = currentInv.find(i => i.name === 'dirt')?.count || 0;
  const cobbleAvailable = currentInv.find(i => i.name === 'cobblestone')?.count || 0;
  if (cobbleAvailable > 0 && blocksToUse === 0) blocksToUse = cobbleAvailable;
  if (blocksToUse < 15) {
    // Emergency: try to find dirt nearby
    const dirtNearby = bot.findBlock({
      matching: b => b.name === 'dirt',
      maxDistance: 5
    });
    if (!dirtNearby) { console.log("Block not found"); return; }
    if (dirtNearby) {
      await mineBlock('dirt', 15 - blocksToUse);
    }
  }

  // Build floor (3x3)
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      await placeItem('dirt', x + dx, y - 1, z + dz);
    }
  }

  // Build walls - north, south, west walls (leave east open for door)
  // North wall (z-1)
  for (let dx = -1; dx <= 1; dx++) {
    for (let h = 0; h <= 1; h++) {
      await placeItem('dirt', x + dx, y + h, z - 1);
    }
  }

  // South wall (z+1)
  for (let dx = -1; dx <= 1; dx++) {
    for (let h = 0; h <= 1; h++) {
      await placeItem('dirt', x + dx, y + h, z + 1);
    }
  }

  // West wall (x-1)
  for (let dz = -1; dz <= 1; dz++) {
    for (let h = 0; h <= 1; h++) {
      await placeItem('dirt', x - 1, y + h, z + dz);
    }
  }

  // Ceiling (3x3 at y+2)
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      await placeItem('dirt', x + dx, y + 2, z + dz);
    }
  }

  // Wait for night and sleep
  await bot.waitForTicks(100); // Let night approach

  // Check for bed
  const bed = bot.inventory.items().find(i => i.name.endsWith('_bed'));
  if (bed) {
    // Place bed and sleep
    await bot.equip(bed, 'hand');
    await placeItem(bed.name, x + 1, y, z);
    await bot.waitForTicks(20);
    // Try to sleep
    const bedBlock = bot.findBlock({
      matching: b => b.name.endsWith('_bed'),
      maxDistance: 3
    });
    if (bedBlock) {
      try {
        await bot.sleep();
      } catch {
        // Not night yet or can't sleep
      }
    }
  } else {
    // Stay inside shelter until morning
    const isNight = () => {
      const time = bot.time?.timeOfDay;
      return time !== undefined && (time < 12500 || time > 23000);
    };
    while (isNight()) {
      await bot.waitForTicks(100);
      // Stay near center of shelter
      if (bot.entity.position.distanceTo(pos) > 2) {
        await moveTo(x, y, z, 1, 5);
      }
    }
  }
}