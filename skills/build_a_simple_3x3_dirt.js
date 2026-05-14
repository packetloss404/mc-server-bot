async function buildASimple3x3Dirt(bot) {
  // Check if enough dirt is available, if not, mine some.
  let dirtCount = bot.inventory.items().find(item => item.name === 'dirt')?.count || 0;
  if (dirtCount < 16) {
    // Need at least 16 for a 3x3x2 hut with one opening
    await mineBlock('dirt', 16 - dirtCount);
  }
  const botX = Math.floor(bot.entity.position.x);
  const botY = Math.floor(bot.entity.position.y);
  const botZ = Math.floor(bot.entity.position.z);

  // Define the base position for the hut relative to the bot
  // We'll build it slightly away from the bot's current position to avoid self-blocking
  const startX = botX + 2;
  const startY = botY;
  const startZ = botZ;

  // Build the first layer (floor is not explicitly asked, just walls)
  // Let's assume the bot is on a flat surface and build around startX, startY, startZ
  // The hut will be 3x3, so the blocks will be placed from (startX, startZ) to (startX+2, startZ+2)

  // Wall 1: (startX, startZ) to (startX, startZ+2)
  await placeItem('dirt', startX, startY, startZ);
  await placeItem('dirt', startX, startY, startZ + 1);
  await placeItem('dirt', startX, startY, startZ + 2);

  // Wall 2: (startX+1, startZ+2) to (startX+1, startZ) - this makes the back wall
  await placeItem('dirt', startX + 1, startY, startZ + 2);

  // Wall 3: (startX+2, startZ+2) to (startX+2, startZ)
  await placeItem('dirt', startX + 2, startY, startZ + 2);
  await placeItem('dirt', startX + 2, startY, startZ + 1);
  await placeItem('dirt', startX + 2, startY, startZ);

  // Wall 4: (startX+1, startZ) - leaving a 1-block opening for a door
  // This will be the front wall, leaving (startX+1, startZ) open for the "door"

  // Build the second layer
  // Wall 1: (startX, startZ) to (startX, startZ+2)
  await placeItem('dirt', startX, startY + 1, startZ);
  await placeItem('dirt', startX, startY + 1, startZ + 1);
  await placeItem('dirt', startX, startY + 1, startZ + 2);

  // Wall 2: (startX+1, startZ+2)
  await placeItem('dirt', startX + 1, startY + 1, startZ + 2);

  // Wall 3: (startX+2, startZ+2) to (startX+2, startZ)
  await placeItem('dirt', startX + 2, startY + 1, startZ + 2);
  await placeItem('dirt', startX + 2, startY + 1, startZ + 1);
  await placeItem('dirt', startX + 2, startY + 1, startZ);

  // Wall 4: (startX+1, startZ) - this is the block above the door opening
  await placeItem('dirt', startX + 1, startY + 1, startZ);
}