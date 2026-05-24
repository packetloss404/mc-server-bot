async function seek_shelter_urgently_rainy_night(bot) {
  const pos = bot.entity.position;
  const bx = Math.floor(pos.x);
  const by = Math.floor(pos.y);
  const bz = Math.floor(pos.z);

  // Gather 15 dirt blocks first
  let dirtCount = bot.inventory.items().filter(i => i.name === 'dirt').reduce((sum, i) => sum + i.count, 0);
  if (dirtCount < 15) {
    await mineBlock('dirt', 15 - dirtCount);
  }

  // Get inventory snapshot
  const inv = bot.inventory.items();
  const dirt = inv.find(i => i.name === 'dirt');
  if (!dirt) return;

  // Build a 3x3x2 shelter centered on bot
  // First, create floor at y-1 by filling 3x3 (but skip center where bot stands)
  // Then build walls at eye level (by+1) and base level (by)
  // Leave south side (z+1) open as door

  // Floor: fill 3x3 area at y-1 except under bot
  const floorPositions = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx !== 0 || dz !== 0) {
        floorPositions.push({
          x: bx + dx,
          y: by - 1,
          z: bz + dz
        });
      }
    }
  }

  // Wall positions: north wall (z-2), east wall (x+2), west wall (x-2), south partial
  const wallPositions = [];
  // North wall (z-2): full 3 blocks
  for (let dx = -1; dx <= 1; dx++) {
    wallPositions.push({
      x: bx + dx,
      y: by,
      z: bz - 2
    });
    wallPositions.push({
      x: bx + dx,
      y: by + 1,
      z: bz - 2
    });
  }
  // East wall (x+2): 3 blocks, skip door at z-1
  for (let dz = -1; dz <= 1; dz++) {
    if (dz !== -1) {
      wallPositions.push({
        x: bx + 2,
        y: by,
        z: bz + dz
      });
      wallPositions.push({
        x: bx + 2,
        y: by + 1,
        z: bz + dz
      });
    }
  }
  // West wall (x-2): full 3 blocks
  for (let dz = -1; dz <= 1; dz++) {
    wallPositions.push({
      x: bx - 2,
      y: by,
      z: bz + dz
    });
    wallPositions.push({
      x: bx - 2,
      y: by + 1,
      z: bz + dz
    });
  }
  // South wall (z+2): full 3 blocks
  for (let dx = -1; dx <= 1; dx++) {
    wallPositions.push({
      x: bx + dx,
      y: by,
      z: bz + 2
    });
    wallPositions.push({
      x: bx + dx,
      y: by + 1,
      z: bz + 2
    });
  }

  // Roof: 3x3 at y+2
  const roofPositions = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      roofPositions.push({
        x: bx + dx,
        y: by + 2,
        z: bz + dz
      });
    }
  }

  // Build floor first
  for (const p of floorPositions) {
    const block = bot.blockAt(p);
    if (block && block.name !== 'air' && block.name !== 'water') {
      await mineBlock(block.name, 1);
      await bot.waitForTicks(2);
    }
    await placeItem('dirt', p.x, p.y, p.z);
    await bot.waitForTicks(2);
  }

  // Build walls
  for (const p of wallPositions) {
    const block = bot.blockAt(p);
    if (block && block.name !== 'air' && block.name !== 'water') {
      continue; // Skip occupied blocks
    }
    await placeItem('dirt', p.x, p.y, p.z);
    await bot.waitForTicks(2);
  }

  // Build roof
  for (const p of roofPositions) {
    const block = bot.blockAt(p);
    if (block && block.name !== 'air' && block.name !== 'water') {
      continue;
    }
    await placeItem('dirt', p.x, p.y, p.z);
    await bot.waitForTicks(2);
  }
}