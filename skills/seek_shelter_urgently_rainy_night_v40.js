async function seek_shelter_urgently_rainy_night(bot) {
  const pos = bot.entity.position;
  const bx = Math.floor(pos.x);
  const by = Math.floor(pos.y);
  const bz = Math.floor(pos.z);

  // Use cobblestone (we have 41)
  const inv = bot.inventory.items();
  const cobble = inv.find(i => i.name === 'cobblestone');
  if (!cobble) return;

  // Floor at y-1 (under feet) — 3x3
  await placeItem('cobblestone', bx - 1, by - 1, bz - 1);
  await placeItem('cobblestone', bx, by - 1, bz - 1);
  await placeItem('cobblestone', bx + 1, by - 1, bz - 1);
  await placeItem('cobblestone', bx - 1, by - 1, bz);
  await placeItem('cobblestone', bx + 1, by - 1, bz);
  await placeItem('cobblestone', bx - 1, by - 1, bz + 1);
  await placeItem('cobblestone', bx, by - 1, bz + 1);
  await placeItem('cobblestone', bx + 1, by - 1, bz + 1);

  // Wall layer 1 at y-1 (ground) — leave south (z+1) open
  await placeItem('cobblestone', bx - 1, by - 1, bz - 1);
  await placeItem('cobblestone', bx, by - 1, bz - 1);
  await placeItem('cobblestone', bx - 1, by - 1, bz);
  await placeItem('cobblestone', bx + 1, by - 1, bz);
  await placeItem('cobblestone', bx - 1, by - 1, bz + 1);
  // door gap at (bx, by-1, bz+1) intentionally left open

  // Wall layer 2 at y (eye level) — leave south (z+1) open
  await placeItem('cobblestone', bx - 1, by, bz - 1);
  await placeItem('cobblestone', bx, by, bz - 1);
  await placeItem('cobblestone', bx + 1, by, bz - 1);
  await placeItem('cobblestone', bx - 1, by, bz);
  await placeItem('cobblestone', bx + 1, by, bz);
  // door gap at (bx, by, bz+1) intentionally left open
}