async function seek_shelter_urgently_rainy_night(bot) {
  const pos = bot.entity.position;
  const bx = Math.floor(pos.x);
  const by = Math.floor(pos.y);
  const bz = Math.floor(pos.z);

  // Bot already has 10 dirt - use all of them for shelter
  const dirt = bot.inventory.items().find(i => i.name === 'dirt');
  if (!dirt) return;

  // Build a small 3x2 shelter using 10 dirt blocks total:
  // - 4 blocks for 2x2 floor at y-1 (under bot)
  // - 3 blocks for south wall (with door gap in middle)
  // - 3 blocks for west wall
  // Floor (y-1): 2x2 under bot
  await placeItem('dirt', bx, by - 1, bz);
  await placeItem('dirt', bx + 1, by - 1, bz);
  await placeItem('dirt', bx, by - 1, bz + 1);
  await placeItem('dirt', bx + 1, by - 1, bz + 1);

  // South wall (z + 1): blocks at corners, gap in middle for door
  await placeItem('dirt', bx, by, bz + 2);
  // Door gap at (bx+1, by, bz+2)
  await placeItem('dirt', bx + 2, by, bz + 2);

  // West wall (x - 1): 3 blocks
  await placeItem('dirt', bx - 1, by, bz);
  await placeItem('dirt', bx - 1, by, bz + 1);
  await placeItem('dirt', bx - 1, by, bz + 2);
}