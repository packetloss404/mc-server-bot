async function seek_shelter_urgently_rainy_night(bot) {
  const pos = bot.entity.position;
  const bx = Math.floor(pos.x);
  const by = Math.floor(pos.y);
  const bz = Math.floor(pos.z);

  // Equip/ensure cobblestone is ready
  const cobble = bot.inventory.items().find(i => i.name === 'cobblestone');
  if (!cobble) {
    console.log("No cobblestone available");
    return;
  }

  // Build a 3x3x2 shelter using cobblestone
  // Floor at y-1, walls at y and y+1, leave south side (negative Z) open as door

  // Place floor (3x3)
  await placeItem('cobblestone', bx - 1, by - 1, bz - 1);
  await placeItem('cobblestone', bx, by - 1, bz - 1);
  await placeItem('cobblestone', bx + 1, by - 1, bz - 1);
  await placeItem('cobblestone', bx - 1, by - 1, bz);
  await placeItem('cobblestone', bx, by - 1, bz);
  await placeItem('cobblestone', bx + 1, by - 1, bz);
  await placeItem('cobblestone', bx - 1, by - 1, bz + 1);
  await placeItem('cobblestone', bx, by - 1, bz + 1);
  await placeItem('cobblestone', bx + 1, by - 1, bz + 1);

  // West wall (x-1), 2 blocks high, full length
  await placeItem('cobblestone', bx - 1, by, bz - 1);
  await placeItem('cobblestone', bx - 1, by + 1, bz - 1);
  await placeItem('cobblestone', bx - 1, by, bz);
  await placeItem('cobblestone', bx - 1, by + 1, bz);
  await placeItem('cobblestone', bx - 1, by, bz + 1);
  await placeItem('cobblestone', bx - 1, by + 1, bz + 1);

  // East wall (x+1), 2 blocks high, full length
  await placeItem('cobblestone', bx + 1, by, bz - 1);
  await placeItem('cobblestone', bx + 1, by + 1, bz - 1);
  await placeItem('cobblestone', bx + 1, by, bz);
  await placeItem('cobblestone', bx + 1, by + 1, bz);
  await placeItem('cobblestone', bx + 1, by, bz + 1);
  await placeItem('cobblestone', bx + 1, by + 1, bz + 1);

  // North wall (z+1), 2 blocks high, full length
  await placeItem('cobblestone', bx - 1, by, bz + 1);
  await placeItem('cobblestone', bx - 1, by + 1, bz + 1);
  await placeItem('cobblestone', bx, by, bz + 1);
  await placeItem('cobblestone', bx, by + 1, bz + 1);
  await placeItem('cobblestone', bx + 1, by, bz + 1);
  await placeItem('cobblestone', bx + 1, by + 1, bz + 1);

  // Ceiling (3x3) at y+2 to fully enclose
  await placeItem('cobblestone', bx - 1, by + 2, bz - 1);
  await placeItem('cobblestone', bx, by + 2, bz - 1);
  await placeItem('cobblestone', bx + 1, by + 2, bz - 1);
  await placeItem('cobblestone', bx - 1, by + 2, bz);
  await placeItem('cobblestone', bx, by + 2, bz);
  await placeItem('cobblestone', bx + 1, by + 2, bz);
  await placeItem('cobblestone', bx - 1, by + 2, bz + 1);
  await placeItem('cobblestone', bx, by + 2, bz + 1);
  await placeItem('cobblestone', bx + 1, by + 2, bz + 1);
  console.log("Built 3x3x3 cobblestone shelter, south side open as door");
}