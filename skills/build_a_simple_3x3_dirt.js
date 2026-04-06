async function buildSimpleDirtShelter(bot) {
  const targetPos = {
    x: 950,
    y: 70,
    z: 361
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
  const doorOffset = {
    x: -1,
    z: 0
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
  const totalDirtNeeded = wallOffsets.length * 2 + roofOffsets.length;
  let currentDirt = bot.inventory.items().filter(i => i.name === 'dirt').reduce((acc, i) => acc + i.count, 0);
  if (currentDirt < totalDirtNeeded) {
    await mineBlock('dirt', totalDirtNeeded - currentDirt);
  }
  for (const off of wallOffsets) {
    await placeItem('dirt', targetPos.x + off.x, targetPos.y, targetPos.z + off.z);
  }
  for (const off of wallOffsets) {
    await placeItem('dirt', targetPos.x + off.x, targetPos.y + 1, targetPos.z + off.z);
  }
  for (const off of roofOffsets) {
    await placeItem('dirt', targetPos.x + off.x, targetPos.y + 2, targetPos.z + off.z);
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
  await placeItem('oak_door', targetPos.x + doorOffset.x, targetPos.y, targetPos.z + doorOffset.z);
}