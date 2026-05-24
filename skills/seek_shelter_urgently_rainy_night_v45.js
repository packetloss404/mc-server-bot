async function seek_shelter_urgently_rainy_night(bot) {
  const pos = bot.entity.position;
  const bx = Math.floor(pos.x);
  const by = Math.floor(pos.y);
  const bz = Math.floor(pos.z);

  // Get building blocks - prefer dirt, then cobblestone, then oak_log
  const inv = bot.inventory.items();
  const dirt = inv.find(i => i.name === 'dirt');
  const cobble = inv.find(i => i.name === 'cobblestone');
  const oakLog = inv.find(i => i.name === 'oak_log');
  const buildBlock = dirt || cobble || oakLog;
  if (!buildBlock) return;
  const blockName = buildBlock.name;

  // Gather more dirt if needed
  const dirtCount = inv.filter(i => i.name === 'dirt').reduce((sum, i) => sum + i.count, 0);
  if (dirtCount < 15) {
    const nearbyDirt = bot.findBlock({
      matching: b => b.name === 'dirt',
      maxDistance: 5
    });
    if (!nearbyDirt) { console.log("Block not found"); return; }
    if (nearbyDirt) {
      await mineBlock('dirt', 15 - dirtCount);
    }
  }

  // Build a 3x3x2 shelter (walls at y and y+1, ceiling at y+2)
  // Leave south side (negative Z) open for door/entrance

  // West wall (x = bx - 1), 2 blocks high
  await placeItem(blockName, bx - 1, by, bz - 1);
  await placeItem(blockName, bx - 1, by, bz);
  await placeItem(blockName, bx - 1, by, bz + 1);
  await placeItem(blockName, bx - 1, by + 1, bz - 1);
  await placeItem(blockName, bx - 1, by + 1, bz);
  await placeItem(blockName, bx - 1, by + 1, bz + 1);

  // North wall (z = bz + 1), 2 blocks high
  await placeItem(blockName, bx, by, bz + 1);
  await placeItem(blockName, bx, by + 1, bz + 1);
  await placeItem(blockName, bx - 1, by, bz + 1);
  await placeItem(blockName, bx - 1, by + 1, bz + 1);

  // East wall (x = bx + 1), 2 blocks high
  await placeItem(blockName, bx + 1, by, bz - 1);
  await placeItem(blockName, bx + 1, by, bz);
  await placeItem(blockName, bx + 1, by, bz + 1);
  await placeItem(blockName, bx + 1, by + 1, bz - 1);
  await placeItem(blockName, bx + 1, by + 1, bz);
  await placeItem(blockName, bx + 1, by + 1, bz + 1);

  // Ceiling (y = by + 2), 3x3
  await placeItem(blockName, bx - 1, by + 2, bz - 1);
  await placeItem(blockName, bx - 1, by + 2, bz);
  await placeItem(blockName, bx - 1, by + 2, bz + 1);
  await placeItem(blockName, bx, by + 2, bz - 1);
  await placeItem(blockName, bx, by + 2, bz);
  await placeItem(blockName, bx, by + 2, bz + 1);
  await placeItem(blockName, bx + 1, by + 2, bz - 1);
  await placeItem(blockName, bx + 1, by + 2, bz);
  await placeItem(blockName, bx + 1, by + 2, bz + 1);

  // Door frame on south side - doorposts at corners
  await placeItem(blockName, bx - 1, by + 1, bz - 1);
  await placeItem(blockName, bx + 1, by + 1, bz - 1);

  // Fill in south wall at ground level except entrance gap
  await placeItem(blockName, bx - 1, by, bz - 1);
  await placeItem(blockName, bx + 1, by, bz - 1);
}