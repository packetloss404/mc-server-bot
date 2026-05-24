async function seek_shelter_urgently_rainy_night(bot) {
  const pos = bot.entity.position;
  const bx = Math.floor(pos.x);
  const by = Math.floor(pos.y);
  const bz = Math.floor(pos.z);

  // Get dirt or cobblestone from inventory
  const dirt = bot.inventory.items().find(i => i.name === 'dirt');
  const cobble = bot.inventory.items().find(i => i.name === 'cobblestone');
  const material = dirt || cobble;
  if (!material) return;
  const matName = material.name;

  // Quick 3x3x2 shelter - walls on 3 sides (N, E, W), open on S as door
  // Layer 1 (y = by): walls at north edge and side walls
  const layer1 = [];
  // North wall (bz-1)
  for (let x = -1; x <= 1; x++) layer1.push({
    x: bx + x,
    y: by,
    z: bz - 1
  });
  // West wall (bx-1, bz to bz+1)
  layer1.push({
    x: bx - 1,
    y: by,
    z: bz
  });
  // East wall (bx+1, bz to bz+1)
  layer1.push({
    x: bx + 1,
    y: by,
    z: bz
  });

  // Layer 2 (y = by+1): same pattern
  const layer2 = [];
  for (let x = -1; x <= 1; x++) layer2.push({
    x: bx + x,
    y: by + 1,
    z: bz - 1
  });
  layer2.push({
    x: bx - 1,
    y: by + 1,
    z: bz
  });
  layer2.push({
    x: bx + 1,
    y: by + 1,
    z: bz
  });

  // Layer 3 (roof, y = by+2): full 3x3
  const layer3 = [];
  for (let x = -1; x <= 1; x++) {
    for (let z = -1; z <= 1; z++) layer3.push({
      x: bx + x,
      y: by + 2,
      z: bz + z
    });
  }

  // Build all layers
  for (const p of layer1) await placeItem(matName, p.x, p.y, p.z);
  for (const p of layer2) await placeItem(matName, p.x, p.y, p.z);
  for (const p of layer3) await placeItem(matName, p.x, p.y, p.z);
}