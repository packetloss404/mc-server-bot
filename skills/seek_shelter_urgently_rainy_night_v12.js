async function seek_shelter_urgently_rainy_night(bot) {
  const pos = bot.entity.position;

  // Gather dirt blocks first - need 10-20 for a small shelter
  const dirtCount = bot.inventory.items().filter(i => i.name === 'dirt').reduce((sum, i) => sum + i.count, 0);
  if (dirtCount < 15) {
    const nearbyDirt = bot.findBlock({
      matching: b => b.name === 'dirt',
      maxDistance: 5
    });
    if (!nearbyDirt) { console.log("Block not found"); return; }
    if (nearbyDirt) {
      await mineBlock('dirt', 15);
    }
  }

  // Build a 3x3x2 shelter (simpler, uses fewer blocks)
  // Build walls at eye level and below (2 blocks high)
  // Leave south side open as door
  const bx = Math.floor(pos.x);
  const by = Math.floor(pos.y);
  const bz = Math.floor(pos.z);

  // Get dirt from inventory
  const dirt = bot.inventory.items().find(i => i.name === 'dirt');
  if (!dirt) return;

  // Build 3x3 floor first at y-1 (under feet)
  await placeItem('dirt', bx - 1, by - 1, bz - 1);
  await placeItem('dirt', bx, by - 1, bz - 1);
  await placeItem('dirt', bx + 1, by - 1, bz - 1);
  await placeItem('dirt', bx - 1, by - 1, bz);
  await placeItem('dirt', bx, by - 1, bz);
  await placeItem('dirt', bx + 1, by - 1, bz);
  await placeItem('dirt', bx - 1, by - 1, bz + 1);
  await placeItem('dirt', bx, by - 1, bz + 1);
  await placeItem('dirt', bx + 1, by - 1, bz + 1);

  // Build north wall (z-1) - 3 blocks, 2 high
  await placeItem('dirt', bx - 1, by, bz - 1);
  await placeItem('dirt', bx, by, bz - 1);
  await placeItem('dirt', bx + 1, by, bz - 1);
  await placeItem('dirt', bx - 1, by + 1, bz - 1);
  await placeItem('dirt', bx, by + 1, bz - 1);
  await placeItem('dirt', bx + 1, by + 1, bz - 1);

  // Build west wall (x-1) - 3 blocks, 2 high
  await placeItem('dirt', bx - 1, by, bz);
  await placeItem('dirt', bx - 1, by + 1, bz);

  // Build east wall (x+1) - 3 blocks, 2 high
  await placeItem('dirt', bx + 1, by, bz);
  await placeItem('dirt', bx + 1, by, bz + 1);
  await placeItem('dirt', bx + 1, by + 1, bz);
  await placeItem('dirt', bx + 1, by + 1, bz + 1);

  // Build south wall (z+1) - bottom row only, door opening at center
  await placeItem('dirt', bx - 1, by, bz + 1);
  await placeItem('dirt', bx + 1, by, bz + 1);
  await placeItem('dirt', bx - 1, by + 1, bz + 1);
  await placeItem('dirt', bx + 1, by + 1, bz + 1);

  // Build ceiling - 3x3 at y+2
  await placeItem('dirt', bx - 1, by + 2, bz - 1);
  await placeItem('dirt', bx, by + 2, bz - 1);
  await placeItem('dirt', bx + 1, by + 2, bz - 1);
  await placeItem('dirt', bx - 1, by + 2, bz);
  await placeItem('dirt', bx, by + 2, bz);
  await placeItem('dirt', bx + 1, by + 2, bz);
  await placeItem('dirt', bx - 1, by + 2, bz + 1);
  await placeItem('dirt', bx, by + 2, bz + 1);
  await placeItem('dirt', bx + 1, by + 2, bz + 1);
}