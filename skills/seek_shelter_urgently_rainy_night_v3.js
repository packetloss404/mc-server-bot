async function seek_shelter_urgently_rainy_night(bot) {
  const pos = bot.entity.position;

  // Check current inventory for building materials
  let dirtCount = bot.inventory.items().filter(i => i.name === 'dirt').reduce((sum, i) => sum + i.count, 0);
  let cobbleCount = bot.inventory.items().filter(i => i.name === 'cobblestone').reduce((sum, i) => sum + i.count, 0);

  // If no dirt/cobblestone, mine some nearby blocks
  if (dirtCount < 15 && cobbleCount < 15) {
    // Look for nearby dirt or grass_block to mine
    const grassBlock = bot.findBlock({
      matching: b => b.name === 'grass_block',
      maxDistance: 8
    });
    if (!grassBlock) { console.log("Block not found"); return; }
    const dirtBlock = bot.findBlock({
      matching: b => b.name === 'dirt',
      maxDistance: 8
    });
    if (!dirtBlock) { console.log("Block not found"); return; }
    if (grassBlock) {
      await mineBlock('grass_block', 15);
      dirtCount = 15;
    } else if (dirtBlock) {
      await mineBlock('dirt', 15);
      dirtCount = 15;
    } else {
      // Fall back to cobblestone if available nearby
      const cobbleBlock = bot.findBlock({
        matching: b => b.name === 'cobblestone',
        maxDistance: 8
      });
      if (!cobbleBlock) { console.log("Block not found"); return; }
      if (cobbleBlock) {
        await mineBlock('cobblestone', 15);
        cobbleCount = 15;
      }
    }
  }

  // Re-check inventory after mining
  dirtCount = bot.inventory.items().filter(i => i.name === 'dirt').reduce((sum, i) => sum + i.count, 0);
  cobbleCount = bot.inventory.items().filter(i => i.name === 'cobblestone').reduce((sum, i) => sum + i.count, 0);
  if (dirtCount < 5 && cobbleCount < 5) {
    console.log("Not enough building materials found");
    return;
  }

  // Determine which material to use
  const blockType = dirtCount >= cobbleCount ? 'dirt' : 'cobblestone';

  // Build 3x3x2 shelter (2 blocks high, simpler, uses ~16 blocks)
  // Position: bot stands at center, build around them
  const bx = Math.floor(pos.x);
  const by = Math.floor(pos.y);
  const bz = Math.floor(pos.z);

  // Build floor at y-1 (under bot's feet - safe since we're standing on solid ground)
  // Build walls: 2 blocks high at eye level (by) and below (by-1)
  // Leave south side (positive Z) partially open as door

  // Floor layer (optional - actually let's skip floor and just do walls)
  // Wall positions: corners at (-1,-1), (-1,1), (1,-1), (1,1), edges in between

  // Build north wall (z-1): 3 blocks at x-1, x, x+1
  await placeItem(blockType, bx - 1, by, bz - 1); // corner
  await placeItem(blockType, bx, by, bz - 1); // middle
  await placeItem(blockType, bx + 1, by, bz - 1); // corner

  // Build north wall lower layer
  await placeItem(blockType, bx - 1, by - 1, bz - 1);
  await placeItem(blockType, bx, by - 1, bz - 1);
  await placeItem(blockType, bx + 1, by - 1, bz - 1);

  // Build west wall (x-1): 3 blocks at z-1, z, z+1 (south is door, skip middle at by and above)
  await placeItem(blockType, bx - 1, by, bz); // middle - door opening at eye level
  await placeItem(blockType, bx - 1, by - 1, bz); // lower door
  await placeItem(blockType, bx - 1, by - 1, bz - 1); // corner
  await placeItem(blockType, bx - 1, by - 1, bz + 1); // corner

  // Build east wall (x+1): 3 blocks
  await placeItem(blockType, bx + 1, by, bz);
  await placeItem(blockType, bx + 1, by - 1, bz - 1); // corner
  await placeItem(blockType, bx + 1, by - 1, bz); // middle
  await placeItem(blockType, bx + 1, by - 1, bz + 1); // corner

  // Build south wall (z+1): only corners, leave door open
  await placeItem(blockType, bx - 1, by, bz + 1); // corner
  await placeItem(blockType, bx - 1, by - 1, bz + 1);
  await placeItem(blockType, bx + 1, by, bz + 1); // corner
  await placeItem(blockType, bx + 1, by - 1, bz + 1);
  console.log("Built emergency shelter around position", bx, by, bz);
}