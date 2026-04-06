async function buildA3x3StoneShelter(bot) {
  const targetPos = {
    x: 952,
    y: 61,
    z: 345
  };
  const wallOffsets = [{
    x: 1,
    z: 1
  }, {
    x: 1,
    z: 0
  }, {
    x: 1,
    z: -1
  }, {
    x: 0,
    z: 1
  }, {
    x: 0,
    z: -1
  }, {
    x: -1,
    z: 1
  }, {
    x: -1,
    z: -1
  }];
  const doorPos = {
    x: 951,
    y: 61,
    z: 345
  };
  const roofOffsets = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      roofOffsets.push({
        x: dx,
        z: dz
      });
    }
  }
  const totalStoneNeeded = wallOffsets.length * 2 + roofOffsets.length;
  let currentStone = bot.inventory.items().filter(i => i.name === 'cobblestone' || i.name === 'stone').reduce((acc, i) => acc + i.count, 0);
  if (currentStone < totalStoneNeeded) {
    await mineBlock('stone', totalStoneNeeded - currentStone);
  }
  const stoneItem = bot.inventory.items().find(i => i.name === 'cobblestone' || i.name === 'stone');
  const stoneName = stoneItem ? stoneItem.name : 'cobblestone';

  // Build Walls Layer 1
  for (const off of wallOffsets) {
    await placeItem(stoneName, targetPos.x + off.x, targetPos.y, targetPos.z + off.z);
  }
  // Build Walls Layer 2
  for (const off of wallOffsets) {
    await placeItem(stoneName, targetPos.x + off.x, targetPos.y + 1, targetPos.z + off.z);
  }
  // Build Roof
  for (const off of roofOffsets) {
    await placeItem(stoneName, targetPos.x + off.x, targetPos.y + 2, targetPos.z + off.z);
  }

  // Place Door
  let doorItem = bot.inventory.items().find(i => i.name.endsWith('_door'));
  if (!doorItem) {
    await craftItem('oak_door', 1);
    doorItem = bot.inventory.items().find(i => i.name.endsWith('_door'));
  }
  if (doorItem) {
    await placeItem(doorItem.name, doorPos.x, doorPos.y, doorPos.z);
  }
}