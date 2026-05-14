async function buildSmall3x3StoneShelter(bot) {
  const COBBLESTONE_NEEDED = 20; // 3x3 base (9) + 3x3 top layer (9) - 1 for door = 17, let's aim for 20
  let cobblestoneCount = bot.inventory.items().find(i => i.name === 'cobblestone')?.count || 0;
  if (cobblestoneCount < COBBLESTONE_NEEDED) {
    await mineBlock('cobblestone', COBBLESTONE_NEEDED - cobblestoneCount);
    cobblestoneCount = bot.inventory.items().find(i => i.name === 'cobblestone')?.count || 0;
    if (cobblestoneCount < COBBLESTONE_NEEDED) {
      // If still not enough, it means we couldn't find/mine enough. Proceed with what we have.
      // Or we could explore more, but for now, let's assume we proceed.
    }
  }
  const botX = Math.floor(bot.entity.position.x);
  const botY = Math.floor(bot.entity.position.y);
  const botZ = Math.floor(bot.entity.position.z);

  // Find a suitable flat spot nearby
  let targetX = botX;
  let targetY = botY;
  let targetZ = botZ;

  // Try to find a block to place next to, or just use current position + offset
  // Let's build it a few blocks away from the current position
  // Adjust Y to be on top of a solid block
  const blockBelow = bot.blockAt(bot.entity.position.offset(0, -1, 0));
  if (blockBelow && blockBelow.type !== 0) {
    // If there's a block below
    targetY = botY;
  } else {
    // If air below, drop down until solid ground
    let yBelow = botY - 1;
    while (yBelow > 0) {
      const block = bot.blockAt(new bot.vec3(botX, yBelow, botZ));
      if (block && block.type !== 0 && block.name !== 'water' && block.name !== 'lava') {
        targetY = yBelow + 1;
        break;
      }
      yBelow--;
    }
    if (yBelow <= 0) {
      // Couldn't find solid ground, default to current Y
      targetY = botY;
    }
  }

  // Offset the build location slightly to avoid building on top of the bot
  targetX += 2;
  targetZ += 2;

  // Move to a safe distance to start placing blocks
  await moveTo(targetX - 2, targetY, targetZ - 2, 2, 10);

  // Build a 3x3 base (first layer of walls)
  for (let dz = 0; dz < 3; dz++) {
    for (let dx = 0; dx < 3; dx++) {
      if (dx === 1 && dz === 1) {
        // Skip the center block for now, will be inside
        continue;
      }
      await placeItem('cobblestone', targetX + dx, targetY, targetZ + dz);
    }
  }

  // Build the second layer of walls, leaving a door opening
  for (let dz = 0; dz < 3; dz++) {
    for (let dx = 0; dx < 3; dx++) {
      // Skip the inside blocks and one spot for the door
      if (dx === 1 && dz === 1 || dx === 1 && dz === 0) {
        // Door at X+1, Z+0
        continue;
      }
      await placeItem('cobblestone', targetX + dx, targetY + 1, targetZ + dz);
    }
  }
}