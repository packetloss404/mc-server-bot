async function seek_shelter_urgently_rainy_night(bot) {
  const pos = bot.entity.position;
  const bx = Math.floor(pos.x);
  const by = Math.floor(pos.y);
  const bz = Math.floor(pos.z);

  // First check for nearby cave or overhang
  const cave = bot.findBlock({
    matching: b => b.name === 'cave_air' || b.name === 'air',
    maxDistance: 5
  });
  if (!cave) { console.log("Block not found"); return; }
  if (cave) {
    const cavePos = cave.position;
    if (Math.abs(cavePos.x - bx) > 1 || Math.abs(cavePos.z - bz) > 1) {
      await moveTo(cavePos.x, cavePos.y, cavePos.z, 1, 5);
      return;
    }
  }

  // Build a simple lean-to shelter on 3 sides at eye level (north, east, west)
  // This won't trap the bot since we leave south side open
  const cobble = bot.inventory.items().find(i => i.name === 'cobblestone');
  if (!cobble) return;

  // East wall (2 blocks, bz-1 and bz)
  await placeItem('cobblestone', bx + 1, by, bz - 1);
  await placeItem('cobblestone', bx + 1, by, bz);

  // West wall (2 blocks, bz-1 and bz)
  await placeItem('cobblestone', bx - 1, by, bz - 1);
  await placeItem('cobblestone', bx - 1, by, bz);

  // North wall (3 blocks, covers entire north side)
  await placeItem('cobblestone', bx - 1, by, bz - 1);
  await placeItem('cobblestone', bx, by, bz - 1);
  await placeItem('cobblestone', bx + 1, by, bz - 1);

  // Build second layer on north and sides for more protection
  await placeItem('cobblestone', bx - 1, by + 1, bz - 1);
  await placeItem('cobblestone', bx, by + 1, bz - 1);
  await placeItem('cobblestone', bx + 1, by + 1, bz - 1);
  await placeItem('cobblestone', bx + 1, by + 1, bz);
  await placeItem('cobblestone', bx - 1, by + 1, bz);
}