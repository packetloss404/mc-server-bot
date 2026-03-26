async function plantSugarCaneAndWheat(bot) {
  const farmCenterX = 1048;
  const farmCenterY = 63;
  const farmCenterZ = 237;

  // Move to the farm area
  await moveTo(farmCenterX, farmCenterY, farmCenterZ, 2, 30);

  // Plant 3 sugar cane in a line
  const sugarCanePositions = [{
    x: farmCenterX - 1,
    y: farmCenterY,
    z: farmCenterZ - 1
  }, {
    x: farmCenterX,
    y: farmCenterY,
    z: farmCenterZ - 1
  }, {
    x: farmCenterX + 1,
    y: farmCenterY,
    z: farmCenterZ - 1
  }];
  for (const pos of sugarCanePositions) {
    await placeItem('sugar_cane', pos.x, pos.y, pos.z);
  }

  // Plant 1 wheat seed in the center
  const wheatSeedPosition = {
    x: farmCenterX,
    y: farmCenterY,
    z: farmCenterZ
  };
  await placeItem('wheat_seeds', wheatSeedPosition.x, wheatSeedPosition.y, wheatSeedPosition.z);
}