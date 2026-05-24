async function seek_shelter_urgently_rainy_night(bot) {
  const pos = bot.entity.position;
  const bx = Math.floor(pos.x);
  const by = Math.floor(pos.y);
  const bz = Math.floor(pos.z);

  // Check inventory for building blocks
  let inv = bot.inventory.items();
  let dirt = inv.find(i => i.name === 'dirt');
  let cobble = inv.find(i => i.name === 'cobblestone');
  let blockToUse = dirt || cobble;
  if (!blockToUse) {
    // Need to gather blocks - check nearby
    const nearbyDirt = bot.findBlock({
      matching: b => b.name === 'dirt',
      maxDistance: 16
    });
    if (!nearbyDirt) { console.log("Block not found"); return; }
    const nearbyCobble = bot.findBlock({
      matching: b => b.name === 'cobblestone',
      maxDistance: 16
    });
    if (!nearbyCobble) { console.log("Block not found"); return; }
    if (nearbyDirt) {
      await mineBlock('dirt', 15);
    } else if (nearbyCobble) {
      await mineBlock('cobblestone', 15);
    } else {
      // Explore to find dirt or cobblestone
      const found = await exploreUntil('south', 15, () => bot.findBlock({
        matching: b => b.name === 'dirt' || b.name === 'cobblestone',
        maxDistance: 16
      }));
      if (found) {
        await mineBlock(found.name, 15);
      }
    }
  }

  // Refresh inventory after gathering
  inv = bot.inventory.items();
  blockToUse = inv.find(i => i.name === 'dirt') || inv.find(i => i.name === 'cobblestone');
  if (!blockToUse) return;
  const blockName = blockToUse.name;

  // Build 3x3x2 shelter (floor + 2 walls, door opening on south)
  // Floor at y-1
  await placeItem(blockName, bx - 1, by - 1, bz - 1);
  await placeItem(blockName, bx, by - 1, bz - 1);
  await placeItem(blockName, bx + 1, by - 1, bz - 1);
  await placeItem(blockName, bx - 1, by - 1, bz);
  await placeItem(blockName, bx + 1, by - 1, bz);
  await placeItem(blockName, bx - 1, by - 1, bz + 1);
  await placeItem(blockName, bx, by - 1, bz + 1);
  await placeItem(blockName, bx + 1, by - 1, bz + 1);

  // West wall (x = bx-1)
  await placeItem(blockName, bx - 1, by, bz - 1);
  await placeItem(blockName, bx - 1, by + 1, bz - 1);
  await placeItem(blockName, bx - 1, by, bz + 1);
  await placeItem(blockName, bx - 1, by + 1, bz + 1);

  // East wall (x = bx+1)
  await placeItem(blockName, bx + 1, by, bz - 1);
  await placeItem(blockName, bx + 1, by + 1, bz - 1);
  await placeItem(blockName, bx + 1, by, bz + 1);
  await placeItem(blockName, bx + 1, by + 1, bz + 1);

  // North wall (z = bz-1) - door opening at center
  await placeItem(blockName, bx - 1, by, bz - 1);
  await placeItem(blockName, bx - 1, by + 1, bz - 1);
  await placeItem(blockName, bx + 1, by, bz - 1);
  await placeItem(blockName, bx + 1, by + 1, bz - 1);
  // Center door opening left empty

  // Ceiling
  await placeItem(blockName, bx - 1, by + 2, bz - 1);
  await placeItem(blockName, bx, by + 2, bz - 1);
  await placeItem(blockName, bx + 1, by + 2, bz - 1);
  await placeItem(blockName, bx - 1, by + 2, bz);
  await placeItem(blockName, bx + 1, by + 2, bz);
  await placeItem(blockName, bx - 1, by + 2, bz + 1);
  await placeItem(blockName, bx, by + 2, bz + 1);
  await placeItem(blockName, bx + 1, by + 2, bz + 1);

  // South wall (z = bz+1) - door opening at center
  await placeItem(blockName, bx - 1, by, bz + 1);
  await placeItem(blockName, bx - 1, by + 1, bz + 1);
  await placeItem(blockName, bx - 1, by + 2, bz + 1);
  await placeItem(blockName, bx + 1, by, bz + 1);
  await placeItem(blockName, bx + 1, by + 1, bz + 1);
  await placeItem(blockName, bx + 1, by + 2, bz + 1);
  // Center door opening at ground level left empty for entry

  // Move into the shelter (to the door opening)
  await moveTo(bx, by, bz + 1, 1, 5);
}