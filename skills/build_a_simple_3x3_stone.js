async function buildA3x3StoneHut(bot) {
  let cobblestoneCount = bot.inventory.items().find(i => i.name === 'cobblestone')?.count || 0;
  let dirtCount = bot.inventory.items().find(i => i.name === 'dirt')?.count || 0;
  let materialName = 'cobblestone';
  if (cobblestoneCount < 20 && dirtCount < 20) {
    if (cobblestoneCount < 20) {
      await mineBlock('cobblestone', 20 - cobblestoneCount);
      cobblestoneCount = bot.inventory.items().find(i => i.name === 'cobblestone')?.count || 0;
    }
    if (cobblestoneCount < 20 && dirtCount < 20) {
      // If still not enough cobblestone, try dirt
      await mineBlock('dirt', 20 - (cobblestoneCount + dirtCount));
      dirtCount = bot.inventory.items().find(i => i.name === 'dirt')?.count || 0;
    }
  }
  if (cobblestoneCount >= 20) {
    materialName = 'cobblestone';
  } else if (dirtCount >= 20) {
    materialName = 'dirt';
  } else {
    // If neither has enough, use whatever is more abundant, or default to cobblestone
    if (cobblestoneCount > dirtCount) {
      materialName = 'cobblestone';
    } else {
      materialName = 'dirt';
    }
    if (bot.inventory.items().find(i => i.name === materialName)?.count < 20) {
      // Not enough material, try to mine more if possible
      await mineBlock(materialName, 20 - (bot.inventory.items().find(i => i.name === materialName)?.count || 0));
    }
  }
  const botX = Math.floor(bot.entity.position.x);
  const botY = Math.floor(bot.entity.position.y);
  const botZ = Math.floor(bot.entity.position.z);

  // Define the base coordinates for the hut
  const startX = botX - 1;
  const startZ = botZ - 1;
  const baseY = botY;

  // Build the first layer (3x3 base)
  for (let x = 0; x < 3; x++) {
    for (let z = 0; z < 3; z++) {
      if (!(x === 1 && z === 1)) {
        // Don't place block directly under bot
        await placeItem(materialName, startX + x, baseY, startZ + z);
      }
    }
  }

  // Build the second layer (2-block high walls, leaving a door opening)
  // Walls
  for (let x = 0; x < 3; x++) {
    for (let z = 0; z < 3; z++) {
      if (x === 0 || x === 2 || z === 0 || z === 2) {
        // Outer perimeter
        if (!(x === 1 && z === 0 || x === 1 && z === 2 || z === 1 && x === 0 || z === 1 && x === 2)) {
          // Door opening
          // Place second layer for walls
          await placeItem(materialName, startX + x, baseY + 1, startZ + z);
        }
      }
    }
  }

  // Place blocks for the roof, leaving a 1x1 opening for a door
  for (let x = 0; x < 3; x++) {
    for (let z = 0; z < 3; z++) {
      // Place roof blocks, leaving a 1-block wide door opening for a 2-block high wall
      if (!(x === 1 && z === 0 || x === 1 && z === 2 || z === 1 && x === 0 || z === 1 && x === 2)) {
        // Door opening
        await placeItem(materialName, startX + x, baseY + 2, startZ + z);
      }
    }
  }
}