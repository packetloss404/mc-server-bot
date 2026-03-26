async function buildPumpkinPatchDisplay(bot) {
  // Check current inventory for pumpkins and oak slabs
  const pumpkins = bot.inventory.items().find(i => i.name === 'pumpkin');
  const pumpkinCount = pumpkins ? pumpkins.count : 0;
  const slabs = bot.inventory.items().find(i => i.name === 'oak_slab');
  const slabCount = slabs ? slabs.count : 0;

  // We need 5 pumpkins and at least 16 oak slabs for a decorative border
  // If we don't have enough oak slabs, craft them from oak planks
  if (slabCount < 16) {
    const planks = bot.inventory.items().find(i => i.name === 'oak_planks');
    const planksNeeded = Math.ceil((16 - slabCount) / 3) * 3; // craft in groups of 3

    if (planks && planks.count >= planksNeeded) {
      // We have enough planks, craft oak slabs
      await craftItem('oak_slab', Math.ceil((16 - slabCount) / 3));
    }
  }

  // Move to a clear area near the base for the display
  // Use position slightly offset from current location
  const displayX = Math.floor(bot.entity.position.x) + 5;
  const displayY = Math.floor(bot.entity.position.y);
  const displayZ = Math.floor(bot.entity.position.z) + 5;
  await moveTo(displayX, displayY, displayZ, 2, 10);

  // Build the oak slab border (5x5 raised frame)
  // Place slabs in a 5x5 square pattern
  const borderOffsets = [
  // Top row
  [0, 0], [1, 0], [2, 0], [3, 0], [4, 0],
  // Bottom row
  [0, 4], [1, 4], [2, 4], [3, 4], [4, 4],
  // Left column (excluding corners already placed)
  [0, 1], [0, 2], [0, 3],
  // Right column (excluding corners already placed)
  [4, 1], [4, 2], [4, 3]];
  for (const [offsetX, offsetZ] of borderOffsets) {
    const slabX = displayX + offsetX;
    const slabZ = displayZ + offsetZ;
    await placeItem('oak_slab', slabX, displayY, slabZ);
  }

  // Place 5 pumpkins in a decorative pattern inside the border (center area)
  const pumpkinPositions = [[displayX + 2, displayY, displayZ + 1],
  // center-top
  [displayX + 1, displayY, displayZ + 2],
  // center-left
  [displayX + 3, displayY, displayZ + 2],
  // center-right
  [displayX + 2, displayY, displayZ + 3],
  // center-bottom
  [displayX + 2, displayY, displayZ + 2] // dead center
  ];
  for (const [pX, pY, pZ] of pumpkinPositions) {
    await placeItem('pumpkin', pX, pY, pZ);
  }
}