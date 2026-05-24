async function seek_shelter_urgently_rainy_night(bot) {
  const pos = bot.entity.position;
  const bx = Math.floor(pos.x);
  const by = Math.floor(pos.y);
  const bz = Math.floor(pos.z);

  // First, move slightly to ensure we have clear build space
  await moveTo(bx + 1, by, bz, 1.5, 5);

  // Use cobblestone - sturdier and we have 10
  const cobble = bot.inventory.items().find(i => i.name === 'cobblestone');
  if (!cobble) {
    // Fall back to oak_log if no cobble
    const log = bot.inventory.items().find(i => i.name === 'oak_log');
    if (!log) return;
  }

  // Build 3x3 floor at y-1
  await placeItem('cobblestone', bx, by - 1, bz);
  await placeItem('cobblestone', bx - 1, by - 1, bz);
  await placeItem('cobblestone', bx + 1, by - 1, bz);
  await placeItem('cobblestone', bx, by - 1, bz - 1);
  await placeItem('cobblestone', bx - 1, by - 1, bz - 1);
  await placeItem('cobblestone', bx + 1, by - 1, bz - 1);
  await placeItem('cobblestone', bx, by - 1, bz + 1);
  await placeItem('cobblestone', bx - 1, by - 1, bz + 1);
  await placeItem('cobblestone', bx + 1, by - 1, bz + 1);

  // North wall (y, y+1) at z-1 - full wall
  await placeItem('cobblestone', bx - 1, by, bz - 1);
  await placeItem('cobblestone', bx, by, bz - 1);
  await placeItem('cobblestone', bx + 1, by, bz - 1);
  await placeItem('cobblestone', bx - 1, by + 1, bz - 1);
  await placeItem('cobblestone', bx, by + 1, bz - 1);
  await placeItem('cobblestone', bx + 1, by + 1, bz - 1);

  // West wall (y, y+1) at x-1 - full wall
  await placeItem('cobblestone', bx - 1, by, bz);
  await placeItem('cobblestone', bx - 1, by, bz + 1);
  await placeItem('cobblestone', bx - 1, by + 1, bz);
  await placeItem('cobblestone', bx - 1, by + 1, bz + 1);

  // East wall (y, y+1) at x+1 - full wall
  await placeItem('cobblestone', bx + 1, by, bz);
  await placeItem('cobblestone', bx + 1, by, bz + 1);
  await placeItem('cobblestone', bx + 1, by + 1, bz);
  await placeItem('cobblestone', bx + 1, by + 1, bz + 1);

  // South wall (y, y+1) at z+1 - door gap at (bx, by)
  await placeItem('cobblestone', bx - 1, by, bz + 1);
  await placeItem('cobblestone', bx - 1, by + 1, bz + 1);
  await placeItem('cobblestone', bx + 1, by, bz + 1);
  await placeItem('cobblestone', bx + 1, by + 1, bz + 1);
}