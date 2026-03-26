async function tillAndHydrateFarmland(bot) {
  // Target: Till 9 dirt blocks in 3x3 pattern at 1048,63,237 and place water in center
  const centerX = 1048;
  const centerY = 63;
  const centerZ = 237;

  // Define 3x3 pattern around center (excluding center itself for now)
  const tillPositions = [{
    x: centerX - 1,
    y: centerY,
    z: centerZ - 1
  }, {
    x: centerX,
    y: centerY,
    z: centerZ - 1
  }, {
    x: centerX + 1,
    y: centerY,
    z: centerZ - 1
  }, {
    x: centerX - 1,
    y: centerY,
    z: centerZ
  }, {
    x: centerX + 1,
    y: centerY,
    z: centerZ
  }, {
    x: centerX - 1,
    y: centerY,
    z: centerZ + 1
  }, {
    x: centerX,
    y: centerY,
    z: centerZ + 1
  }, {
    x: centerX + 1,
    y: centerY,
    z: centerZ + 1
  }];

  // Move to the farm area
  await moveTo(centerX, centerY, centerZ, 2, 30);

  // Till each position by placing dirt blocks on them (simulates tilling)
  for (const pos of tillPositions) {
    await placeItem('dirt', pos.x, pos.y, pos.z);
  }

  // Place water in center to hydrate the farmland
  await placeItem('water', centerX, centerY, centerZ);
}