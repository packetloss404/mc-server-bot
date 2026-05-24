async function seekShelterAndSleepThrough(bot) {
  // Step 1: Ensure we have building materials (dirt/cobblestone)
  let inv = bot.inventory.items();
  let dirtCount = inv.find(i => i.name === 'dirt')?.count || 0;
  let cobbleCount = inv.find(i => i.name === 'cobblestone')?.count || 0;
  let buildingBlocks = dirtCount + cobbleCount;

  // Gather dirt if we need building materials
  if (buildingBlocks < 10) {
    const dirtPos = bot.findBlock({
      matching: b => b.name === 'dirt',
      maxDistance: 32
    });
    if (!dirtPos) { console.log("Block not found"); return; }
    if (dirtPos) {
      await mineBlock('dirt', Math.min(20 - buildingBlocks, 10));
    } else {
      // Fallback to cobblestone
      const stonePos = bot.findBlock({
        matching: b => b.name === 'stone',
        maxDistance: 32
      });
      if (!stonePos) { console.log("Block not found"); return; }
      if (stonePos) {
        await mineBlock('cobblestone', Math.min(20 - buildingBlocks, 10));
      }
    }
  }

  // Step 2: Find or create a safe location to build shelter
  const pos = bot.entity.position;
  const buildX = Math.floor(pos.x);
  const buildY = Math.floor(pos.y);
  const buildZ = Math.floor(pos.z);

  // Step 3: Build a 3x3x3 enclosure (leaving door opening on one side)
  // Build floor layer
  await placeItem('dirt', buildX - 1, buildY, buildZ - 1);
  await placeItem('dirt', buildX, buildY, buildZ - 1);
  await placeItem('dirt', buildX + 1, buildY, buildZ - 1);
  await placeItem('dirt', buildX - 1, buildY, buildZ);
  // Door opening at buildX, buildY, buildZ
  await placeItem('dirt', buildX + 1, buildY, buildZ);
  await placeItem('dirt', buildX - 1, buildY, buildZ + 1);
  await placeItem('dirt', buildX, buildY, buildZ + 1);
  await placeItem('dirt', buildX + 1, buildY, buildZ + 1);

  // Build walls (1 block high - eye level)
  await placeItem('dirt', buildX - 1, buildY + 1, buildZ - 1);
  await placeItem('dirt', buildX, buildY + 1, buildZ - 1);
  await placeItem('dirt', buildX + 1, buildY + 1, buildZ - 1);
  await placeItem('dirt', buildX - 1, buildY + 1, buildZ);
  // Door opening at buildX, buildY + 1, buildZ
  await placeItem('dirt', buildX + 1, buildY + 1, buildZ);
  await placeItem('dirt', buildX - 1, buildY + 1, buildZ + 1);
  await placeItem('dirt', buildX, buildY + 1, buildZ + 1);
  await placeItem('dirt', buildX + 1, buildY + 1, buildZ + 1);

  // Build ceiling layer
  await placeItem('dirt', buildX - 1, buildY + 2, buildZ - 1);
  await placeItem('dirt', buildX, buildY + 2, buildZ - 1);
  await placeItem('dirt', buildX + 1, buildY + 2, buildZ - 1);
  await placeItem('dirt', buildX - 1, buildY + 2, buildZ);
  await placeItem('dirt', buildX, buildY + 2, buildZ);
  await placeItem('dirt', buildX + 1, buildY + 2, buildZ);
  await placeItem('dirt', buildX - 1, buildY + 2, buildZ + 1);
  await placeItem('dirt', buildX, buildY + 2, buildZ + 1);
  await placeItem('dirt', buildX + 1, buildY + 2, buildZ + 1);

  // Step 4: Place crafting table and craft a bed if needed
  const inv2 = bot.inventory.items();
  let hasBed = inv2.find(i => i.name === 'bed') !== undefined;
  if (!hasBed) {
    // Place crafting table inside shelter
    await placeItem('crafting_table', buildX, buildY + 1, buildZ);

    // Craft bed (requires 3 white wool + 3 wood planks)
    // First check if we have materials, if not gather wool from sheep
    let wool = inv2.find(i => i.name === 'white_wool')?.count || 0;
    if (wool < 3) {
      // Kill sheep for wool
      const sheep = bot.nearestEntity(e => e.name === 'sheep' && e.position.distanceTo(bot.entity.position) < 32);
      if (sheep) {
        await killMob('sheep', 10000);
        await killMob('sheep', 10000);
      }
    }

    // Craft planks from wood
    const logs = inv2.find(i => i.name.includes('_log'))?.count || 0;
    if (logs > 0) {
      await craftItem('oak_planks', 4);
    }

    // Craft bed
    await craftItem('bed', 1);
  }

  // Step 5: Place bed inside shelter
  const inv3 = bot.inventory.items();
  const bed = inv3.find(i => i.name === 'bed');
  if (bed) {
    await placeItem('bed', buildX, buildY + 1, buildZ + 1);
  }

  // Step 6: Wait for night and sleep
  await bot.waitForTicks(100); // Wait for potential evening transition
  const bedBlock = bot.findBlock({
    matching: b => b.name === 'bed',
    maxDistance: 5
  });
  if (!bedBlock) { console.log("Block not found"); return; }
  if (bedBlock) {
    const bedItem = bot.inventory.items().find(i => i.name === 'bed');
    if (bedItem) {
      await bot.equip(bedItem, 'hand');
      await bot.useOn(bedBlock);
    }
  }
}