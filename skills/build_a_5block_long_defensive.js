async function buildDefensiveWall(bot) {
  const currentPos = bot.entity.position;
  const startX = Math.floor(currentPos.x);
  const startY = Math.floor(currentPos.y);
  const startZ = Math.floor(currentPos.z) - 1; // North of current position

  // Positions for 5-block long wall at ground level going north
  const wallPositions = [{
    x: startX,
    y: startY,
    z: startZ
  }, {
    x: startX + 1,
    y: startY,
    z: startZ
  }, {
    x: startX + 2,
    y: startY,
    z: startZ
  }, {
    x: startX + 3,
    y: startY,
    z: startZ
  }, {
    x: startX + 4,
    y: startY,
    z: startZ
  }];

  // Check current inventory
  const stoneCount = bot.inventory.items().find(i => i.name === 'stone')?.count || 0;
  const mossCount = bot.inventory.items().find(i => i.name === 'moss_block')?.count || 0;
  const slabCount = bot.inventory.items().find(i => i.name === 'stone_slab')?.count || 0;

  // Mine stone blocks if needed
  if (stoneCount < 3) {
    await mineBlock('stone', 3 - stoneCount);
  }

  // Place wall blocks: alternating stone, moss_block, and stone_slab
  for (let i = 0; i < wallPositions.length; i++) {
    const pos = wallPositions[i];
    const blockType = i % 3 === 0 ? 'stone' : i % 3 === 1 ? 'moss_block' : 'stone_slab';
    await placeItem(blockType, pos.x, pos.y, pos.z);
  }
}