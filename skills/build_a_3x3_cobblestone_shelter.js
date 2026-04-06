async function build3x3CobblestoneShelter(bot) {
  const pos = bot.entity.position.floored();
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
    z: 0
  }, {
    x: -1,
    z: -1
  }];
  for (const off of wallOffsets) {
    await placeItem('cobblestone', pos.x + off.x, pos.y, pos.z + off.z);
  }
  for (const off of wallOffsets) {
    await placeItem('cobblestone', pos.x + off.x, pos.y + 1, pos.z + off.z);
  }
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      await placeItem('cobblestone', pos.x + dx, pos.y + 2, pos.z + dz);
    }
  }
}