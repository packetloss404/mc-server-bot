async function seekShelterAndSleep(bot) {
  // Check if underwater and swim to surface first
  const eyePos = bot.entity.position.offset(0, bot.entity.eyeHeight, 0);
  const eyeBlock = bot.blockAt(eyePos);
  if (eyeBlock && eyeBlock.name.includes('water')) {
    const feet = bot.blockAt(bot.entity.position.offset(0, -1, 0));
    if (feet && feet.name !== 'water' && feet.name !== 'lava') {
      await moveTo(bot.entity.position.x + 4, bot.entity.position.y, bot.entity.position.z, 2, 5);
    } else {
      await bot.look(bot.entity.yaw, -Math.PI / 2);
      bot.setControlState('jump', true);
      bot.setControlState('forward', true);
      await bot.waitForTicks(40);
      bot.clearControlStates();
    }
  }

  // Check inventory for dirt/cobblestone
  const inv = bot.inventory.items();
  const dirtCount = inv.find(i => i.name === 'dirt')?.count || 0;
  const cobbleCount = inv.find(i => i.name === 'cobblestone')?.count || 0;
  const blockCount = dirtCount + cobbleCount;

  // Gather dirt if needed
  if (blockCount < 20) {
    const needed = 20 - blockCount;
    await mineBlock('dirt', needed);
  }

  // Get current position for shelter placement
  const pos = bot.entity.position;
  const floorY = Math.floor(pos.y);

  // Build 3x3 floor
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const block = bot.blockAt(pos.offset(dx, 0, dz));
      if (!block || block.name === 'air') {
        const blockType = inv.find(i => i.name === 'dirt' || i.name === 'cobblestone');
        if (blockType) {
          await placeItem(blockType.name, pos.x + dx, floorY, pos.z + dz);
          await bot.waitForTicks(5);
        }
      }
    }
  }

  // Build 3 walls (leave south side open for door)
  const walls = [];
  // North wall (negative Z)
  for (let x = -1; x <= 1; x++) {
    walls.push({
      x,
      y: floorY + 1,
      z: -1
    });
    walls.push({
      x,
      y: floorY + 2,
      z: -1
    });
  }
  // West wall (negative X)
  for (let z = -1; z <= 1; z++) {
    walls.push({
      x: -1,
      y: floorY + 1,
      z
    });
    walls.push({
      x: -1,
      y: floorY + 2,
      z
    });
  }
  // East wall (positive X)
  for (let z = -1; z <= 1; z++) {
    walls.push({
      x: 1,
      y: floorY + 1,
      z
    });
    walls.push({
      x: 1,
      y: floorY + 2,
      z
    });
  }
  const newInv = bot.inventory.items();
  const buildBlock = newInv.find(i => i.name === 'dirt' || i.name === 'cobblestone');
  for (const w of walls) {
    const block = bot.blockAt(pos.offset(w.x, w.y - floorY, w.z));
    if ((!block || block.name === 'air') && buildBlock) {
      await placeItem(buildBlock.name, pos.x + w.x, w.y, pos.z + w.z);
      await bot.waitForTicks(5);
    }
  }

  // Find and place a bed
  let bed = bot.inventory.items().find(i => i.name?.includes('bed'));
  if (!bed) {
    // Look for bed nearby
    const nearbyBed = bot.findBlock({
      matching: b => b.name?.includes('bed'),
      maxDistance: 32
    });
    if (nearbyBed) {
      await moveTo(nearbyBed.position.x, nearbyBed.position.y, nearbyBed.position.z, 2, 10);
    }
  }
  if (bed) {
    await bot.equip(bed, 'hand');
    await placeItem('bed', pos.x, floorY, pos.z + 1);
    await bot.waitForTicks(10);
    await bot.consume();
  } else {
    // No bed - just wait until morning in shelter
    const startTime = Date.now();
    while (Date.now() - startTime < 120000) {
      const time = bot.time?.timeOfDay || 0;
      if (time > 23000 || time < 1000) break;
      await bot.waitForTicks(100);
    }
  }
}