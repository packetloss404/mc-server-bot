async function seek_shelter_urgently_rainy_night(bot) {
  const pos = bot.entity.position;
  const bx = Math.floor(pos.x);
  const by = Math.floor(pos.y);
  const bz = Math.floor(pos.z);

  // Gather dirt blocks - need 15-20 for a small 3x3x2 shelter
  let dirtCount = bot.inventory.items().filter(i => i.name === 'dirt').reduce((sum, i) => sum + i.count, 0);
  if (dirtCount < 15) {
    // Explore outward to find dirt if none nearby
    let foundDirt = bot.findBlock({
      matching: b => b.name === 'dirt',
      maxDistance: 16
    });
    if (!foundDirt) {
      // Explore until we find dirt
      await exploreUntil('south', 20, () => bot.findBlock({
        matching: b => b.name === 'dirt',
        maxDistance: 32
      }));
    }

    // Mine dirt blocks
    await mineBlock('dirt', 15);
  }

  // Refresh inventory check
  const inv = bot.inventory.items();
  const dirt = inv.find(i => i.name === 'dirt');
  if (!dirt || dirt.count < 12) {
    console.log("Not enough dirt for shelter");
    return;
  }

  // Build a 3x3x2 shelter with dirt
  // Build walls: 2 blocks high, leave south side open as door
  // North wall (y, y+1)
  await placeItem('dirt', bx - 1, by, bz - 1);
  await placeItem('dirt', bx, by, bz - 1);
  await placeItem('dirt', bx + 1, by, bz - 1);
  await placeItem('dirt', bx - 1, by + 1, bz - 1);
  await placeItem('dirt', bx, by + 1, bz - 1);
  await placeItem('dirt', bx + 1, by + 1, bz - 1);

  // East wall (y, y+1)
  await placeItem('dirt', bx + 1, by, bz - 1);
  await placeItem('dirt', bx + 1, by, bz);
  await placeItem('dirt', bx + 1, by + 1, bz - 1);
  await placeItem('dirt', bx + 1, by + 1, bz);

  // West wall (y, y+1)
  await placeItem('dirt', bx - 1, by, bz - 1);
  await placeItem('dirt', bx - 1, by, bz);
  await placeItem('dirt', bx - 1, by + 1, bz - 1);
  await placeItem('dirt', bx - 1, by + 1, bz);

  // Ceiling (y+2)
  await placeItem('dirt', bx - 1, by + 2, bz - 1);
  await placeItem('dirt', bx, by + 2, bz - 1);
  await placeItem('dirt', bx + 1, by + 2, bz - 1);
  await placeItem('dirt', bx - 1, by + 2, bz);
  await placeItem('dirt', bx + 1, by + 2, bz);

  // Floor patches
  await placeItem('dirt', bx - 1, by - 1, bz);
  await placeItem('dirt', bx, by - 1, bz);
  await placeItem('dirt', bx + 1, by - 1, bz);

  // Move inside the shelter
  await moveTo(bx, by, bz, 0.5, 3);
}