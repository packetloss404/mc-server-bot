async function buildSimpleDirtShelter(bot) {
  // Anchor the shelter at the bot's current position so it can be built anywhere.
  const origin = bot.entity.position;
  const ox = Math.floor(origin.x);
  const oy = Math.floor(origin.y);
  const oz = Math.floor(origin.z);
  const wallOffsets = [
    { x: 1, z: 1 }, { x: 1, z: 0 }, { x: 1, z: -1 },
    { x: 0, z: 1 }, { x: 0, z: -1 },
    { x: -1, z: 1 }, { x: -1, z: -1 },
  ];
  const doorOffset = { x: -1, z: 0 };
  const roofOffsets = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      roofOffsets.push({ x: dx, z: dz });
    }
  }
  const totalDirtNeeded = wallOffsets.length * 2 + roofOffsets.length;
  let currentDirt = bot.inventory.items().filter(i => i.name === 'dirt').reduce((acc, i) => acc + i.count, 0);
  if (currentDirt < totalDirtNeeded) {
    await mineBlock('dirt', totalDirtNeeded - currentDirt);
  }
  for (const off of wallOffsets) {
    await placeItem('dirt', ox + off.x, oy, oz + off.z);
  }
  for (const off of wallOffsets) {
    await placeItem('dirt', ox + off.x, oy + 1, oz + off.z);
  }
  for (const off of roofOffsets) {
    await placeItem('dirt', ox + off.x, oy + 2, oz + off.z);
  }
  const door = bot.inventory.items().find(i => i.name === 'oak_door');
  if (!door) {
    const logs = bot.inventory.items().find(i => i.name === 'oak_log');
    if (!logs || logs.count < 2) {
      await mineBlock('oak_log', 2);
    }
    await craftItem('oak_planks', 2);
    await craftItem('oak_door', 1);
  }
  await placeItem('oak_door', ox + doorOffset.x, oy, oz + doorOffset.z);
}
