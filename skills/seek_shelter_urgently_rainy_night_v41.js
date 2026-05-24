async function seek_shelter_urgently_rainy_night(bot) {
  const pos = bot.entity.position;
  const bx = Math.floor(pos.x);
  const by = Math.floor(pos.y);
  const bz = Math.floor(pos.z);

  // Use cobblestone - we have 38, enough for a small shelter
  // Build 3x3 walls (2 high) with south side open as door
  // Only place blocks around the bot, not on its exact position

  const inv = bot.inventory.items();
  const cobble = inv.find(i => i.name === 'cobblestone');
  if (!cobble || cobble.count < 20) return;

  // Build floor at y-1 (3x3)
  await placeItem('cobblestone', bx - 1, by - 1, bz - 1);
  await placeItem('cobblestone', bx, by - 1, bz - 1);
  await placeItem('cobblestone', bx + 1, by - 1, bz - 1);
  await placeItem('cobblestone', bx - 1, by - 1, bz);
  await placeItem('cobblestone', bx + 1, by - 1, bz);
  await placeItem('cobblestone', bx - 1, by - 1, bz + 1);
  await placeItem('cobblestone', bx, by - 1, bz + 1);
  await placeItem('cobblestone', bx + 1, by - 1, bz + 1);

  // North wall (z+1) at eye level and above
  await placeItem('cobblestone', bx - 1, by, bz + 1);
  await placeItem('cobblestone', bx, by, bz + 1);
  await placeItem('cobblestone', bx + 1, by, bz + 1);
  await placeItem('cobblestone', bx - 1, by + 1, bz + 1);
  await placeItem('cobblestone', bx, by + 1, bz + 1);
  await placeItem('cobblestone', bx + 1, by + 1, bz + 1);

  // West wall (x-1) at eye level and above
  await placeItem('cobblestone', bx - 1, by, bz - 1);
  await placeItem('cobblestone', bx - 1, by, bz);
  await placeItem('cobblestone', bx - 1, by + 1, bz - 1);
  await placeItem('cobblestone', bx - 1, by + 1, bz);

  // East wall (x+1) at eye level and above
  await placeItem('cobblestone', bx + 1, by, bz - 1);
  await placeItem('cobblestone', bx + 1, by, bz);
  await placeItem('cobblestone', bx + 1, by + 1, bz - 1);
  await placeItem('cobblestone', bx + 1, by + 1, bz);

  // Roof at y+2
  await placeItem('cobblestone', bx - 1, by + 2, bz - 1);
  await placeItem('cobblestone', bx, by + 2, bz - 1);
  await placeItem('cobblestone', bx + 1, by + 2, bz - 1);
  await placeItem('cobblestone', bx - 1, by + 2, bz);
  await placeItem('cobblestone', bx + 1, by + 2, bz);
  await placeItem('cobblestone', bx - 1, by + 2, bz + 1);
  await placeItem('cobblestone', bx, by + 2, bz + 1);
  await placeItem('cobblestone', bx + 1, by + 2, bz + 1);
}