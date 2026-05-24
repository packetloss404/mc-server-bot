async function seek_shelter_urgently_rainy_night(bot) {
  const pos = bot.entity.position;
  const bx = Math.floor(pos.x);
  const by = Math.floor(pos.y);
  const bz = Math.floor(pos.z);

  // Check what blocks we have available
  const inv = bot.inventory.items();
  let dirtCount = inv.filter(i => i.name === 'dirt').reduce((sum, i) => sum + i.count, 0);

  // If we don't have enough dirt, gather it
  if (dirtCount < 15) {
    const nearbyDirt = bot.findBlock({
      matching: b => b.name === 'dirt',
      maxDistance: 16
    });
    if (!nearbyDirt) { console.log("Block not found"); return; }
    if (nearbyDirt) {
      await mineBlock('dirt', 15);
    }
  }

  // Build a 3x3x2 shelter - build walls at y and y-1 (eye level and below)
  // North wall (z = bz - 1): two blocks high
  // South wall (z = bz + 1): one block at y (door opening at y-1)
  // East wall (x = bx + 1): two blocks high
  // West wall (x = bx - 1): two blocks high

  // Check if positions are free before placing
  const checkAndPlace = async (x, y, z) => {
    const block = bot.blockAt(bot.entity.position.offset(x - bx, y - by, z - bz));
    if (!block || block.name === 'air' || block.name === 'rain') {
      await placeItem('dirt', x, y, z);
    }
  };

  // North wall (front, z-1)
  await checkAndPlace(bx - 1, by, bz - 1);
  await checkAndPlace(bx, by, bz - 1);
  await checkAndPlace(bx + 1, by, bz - 1);
  await checkAndPlace(bx - 1, by - 1, bz - 1);
  await checkAndPlace(bx, by - 1, bz - 1);
  await checkAndPlace(bx + 1, by - 1, bz - 1);

  // South wall (back, z+1) - door at y-1 level
  await checkAndPlace(bx - 1, by, bz + 1);
  await checkAndPlace(bx, by, bz + 1);
  await checkAndPlace(bx + 1, by, bz + 1);
  await checkAndPlace(bx - 1, by - 1, bz + 1);
  // Skip bx, by-1 for door opening
  await checkAndPlace(bx + 1, by - 1, bz + 1);

  // East wall (right, x+1)
  await checkAndPlace(bx + 1, by, bz - 1);
  await checkAndPlace(bx + 1, by, bz);
  await checkAndPlace(bx + 1, by, bz + 1);
  await checkAndPlace(bx + 1, by - 1, bz - 1);
  await checkAndPlace(bx + 1, by - 1, bz);
  await checkAndPlace(bx + 1, by - 1, bz + 1);

  // West wall (left, x-1)
  await checkAndPlace(bx - 1, by, bz - 1);
  await checkAndPlace(bx - 1, by, bz);
  await checkAndPlace(bx - 1, by, bz + 1);
  await checkAndPlace(bx - 1, by - 1, bz - 1);
  await checkAndPlace(bx - 1, by - 1, bz);
  await checkAndPlace(bx - 1, by - 1, bz + 1);
}