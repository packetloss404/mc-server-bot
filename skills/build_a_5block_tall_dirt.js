async function buildDirtWatchtower(bot) {
  // Task: Build a 5-block tall dirt tower at current position
  // Current position: 824, 63, 447
  // Current inventory: dirt x29 (enough for a 5-block tall tower)

  const currentPos = bot.entity.position.floored();
  const towerHeight = 5;

  // Check if we have enough dirt
  let dirtInInventory = bot.inventory.items().find(i => i.name === 'dirt');
  let dirtCount = dirtInInventory ? dirtInInventory.count : 0;

  // If we don't have enough dirt, mine more
  if (dirtCount < towerHeight) {
    await mineBlock('dirt', towerHeight - dirtCount);
  }

  // Build the tower: place dirt blocks vertically at current position
  for (let height = 0; height < towerHeight; height++) {
    await placeItem('dirt', currentPos.x, currentPos.y + height, currentPos.z);
  }
}