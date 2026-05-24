async function seekShelterAndSleepThroughNight(bot) {
  // Check if submerged and swim to surface first
  const eyePos = bot.entity.position.offset(0, bot.entity.eyeHeight, 0);
  const eyeBlock = bot.blockAt(eyePos);
  const isSubmerged = eyeBlock && eyeBlock.name.includes('water');
  if (isSubmerged) {
    await swimToTheSurfaceDrowning(bot);
  }

  // Use existing logs for building (we have 38 total)
  // Build a simple 3x3x2 shelter at current position
  const pos = bot.entity.position;
  const buildPos = pos.floor();

  // Find solid ground to build on
  const groundBlock = bot.blockAt(buildPos.offset(0, -1, 0));
  if (!groundBlock || groundBlock.name === 'water') {
    // Need to find land first
    await moveTo(pos.x + 3, pos.y, pos.z, 2, 10);
  }

  // Place logs to create walls - 3x3x2 structure, leave door opening
  // North wall with door
  await placeItem('oak_log', buildPos.x + 1, buildPos.y, buildPos.z - 1);
  await placeItem('oak_log', buildPos.x + 1, buildPos.y + 1, buildPos.z - 1);
  // East wall
  await placeItem('oak_log', buildPos.x + 2, buildPos.y, buildPos.z);
  await placeItem('oak_log', buildPos.x + 2, buildPos.y, buildPos.z - 1);
  await placeItem('oak_log', buildPos.x + 2, buildPos.y + 1, buildPos.z);
  await placeItem('oak_log', buildPos.x + 2, buildPos.y + 1, buildPos.z - 1);
  // South wall
  await placeItem('oak_log', buildPos.x + 1, buildPos.y, buildPos.z + 1);
  await placeItem('oak_log', buildPos.x + 1, buildPos.y + 1, buildPos.z + 1);
  // West wall
  await placeItem('oak_log', buildPos.x, buildPos.y, buildPos.z);
  await placeItem('oak_log', buildPos.x, buildPos.y, buildPos.z - 1);
  await placeItem('oak_log', buildPos.x, buildPos.y + 1, buildPos.z);
  await placeItem('oak_log', buildPos.x, buildPos.y + 1, buildPos.z - 1);
  // Back corner
  await placeItem('oak_log', buildPos.x + 2, buildPos.y, buildPos.z + 1);
  await placeItem('oak_log', buildPos.x + 2, buildPos.y + 1, buildPos.z + 1);
  await placeItem('oak_log', buildPos.x, buildPos.y, buildPos.z + 1);
  await placeItem('oak_log', buildPos.x, buildPos.y + 1, buildPos.z + 1);

  // Find and place a bed
  const inv = bot.inventory.items();
  const bed = inv.find(i => i.name.includes('bed'));
  if (bed) {
    await moveTo(buildPos.x + 1, buildPos.y, buildPos.z, 1, 5);
    await placeItem('bed', buildPos.x + 1, buildPos.y, buildPos.z);
    // Sleep
    await bot.sleep();
  }
}