async function seek_shelter_urgently_rainy_night(bot) {
  const pos = bot.entity.position;

  // Check for existing shelter nearby - oak_trapdoor suggests a structure
  const trapdoor = bot.findBlock({
    matching: b => b.name === 'oak_trapdoor',
    maxDistance: 16
  });
  if (!trapdoor) { console.log("Block not found"); return; }
  if (trapdoor) {
    // Move to the trapdoor structure - it's a shelter
    await moveTo(trapdoor.position.x, trapdoor.position.y + 1, trapdoor.position.z, 2, 10);
    // Check for stone_bricks or cobblestone_stairs nearby for additional cover
    const cover = bot.findBlock({
      matching: b => b.name === 'stone_bricks' || b.name === 'cobblestone_stairs',
      maxDistance: 8
    });
    if (!cover) { console.log("Block not found"); return; }
    if (cover) {
      await moveTo(cover.position.x, cover.position.y + 1, cover.position.z, 2, 8);
    }
    return;
  }

  // No existing shelter - build a minimal 3x3 shelter
  // Gather cobblestone since dirt mining failed before
  const inv = bot.inventory.items();
  const cobbleCount = inv.filter(i => i.name === 'cobblestone').reduce((sum, i) => sum + i.count, 0);
  const stoneBricksCount = inv.filter(i => i.name === 'stone_bricks').reduce((sum, i) => sum + i.count, 0);

  // Use any available solid blocks
  const totalBlocks = cobbleCount + stoneBricksCount + inv.filter(i => i.name === 'dirt').reduce((sum, i) => sum + i.count, 0);
  if (totalBlocks < 10) {
    // Try to mine cobblestone - it's more reliable
    const cobble = bot.findBlock({
      matching: b => b.name === 'cobblestone',
      maxDistance: 8
    });
    if (!cobble) { console.log("Block not found"); return; }
    if (cobble) {
      await mineBlock('cobblestone', 12);
    } else {
      // Fall back to any stone variant
      const stone = bot.findBlock({
        matching: b => b.name === 'stone' || b.name === 'cobblestone',
        maxDistance: 8
      });
      if (!stone) { console.log("Block not found"); return; }
      if (stone) {
        await mineBlock(stone.name, 12);
      }
    }
  }
  const bx = Math.floor(pos.x);
  const by = Math.floor(pos.y);
  const bz = Math.floor(pos.z);

  // Build a minimal 3x3x2 shelter around the bot (leaving south side open as door)
  // Build at current y level - 1 block to support, walls at y and y-1
  const buildBlocks = ['cobblestone', 'stone_bricks', 'dirt'];
  let blockIndex = 0;
  const getBlock = () => buildBlocks[blockIndex % buildBlocks.length];

  // Build floor under feet first (y-1)
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (!(dx === 0 && dz === -1)) {
        // leave south door open
        await placeItem(getBlock(), bx + dx, by - 1, bz + dz);
        blockIndex++;
      }
    }
  }

  // Build walls at y level (eye level), south side open
  await placeItem(getBlock(), bx - 1, by, bz - 1);
  blockIndex++;
  await placeItem(getBlock(), bx, by, bz - 1);
  blockIndex++;
  await placeItem(getBlock(), bx + 1, by, bz - 1);
  blockIndex++;
  await placeItem(getBlock(), bx - 1, by, bz + 1);
  blockIndex++;
  await placeItem(getBlock(), bx + 1, by, bz + 1);
  blockIndex++;

  // Build walls at y-1 level (below feet), south side open
  await placeItem(getBlock(), bx - 1, by - 1, bz - 1);
  blockIndex++;
  await placeItem(getBlock(), bx + 1, by - 1, bz - 1);
  blockIndex++;
  await placeItem(getBlock(), bx - 1, by - 1, bz + 1);
  blockIndex++;
  await placeItem(getBlock(), bx + 1, by - 1, bz + 1);
  blockIndex++;
}