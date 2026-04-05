async function constructCobblestoneRoom(bot) {
  const startX = Math.floor(bot.entity.position.x) + 3;
  const startY = Math.floor(bot.entity.position.y);
  const startZ = Math.floor(bot.entity.position.z) + 3;
  const items = bot.inventory.items();
  const cobblestone = items.find(i => i.name === 'cobblestone');
  const count = cobblestone ? cobblestone.count : 0;
  if (count < 32) {
    await mineBlock('stone', 32 - count);
  }
  for (let x = 0; x < 3; x++) {
    for (let z = 0; z < 3; z++) {
      await moveTo(startX + x, startY, startZ + z, 4);
      await placeItem('cobblestone', startX + x, startY - 1, startZ + z);
    }
  }
  const perimeter = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]];
  for (let h = 0; h < 2; h++) {
    for (const [dx, dz] of perimeter) {
      if (dx === 1 && dz === 0) continue;
      const tx = startX + dx;
      const ty = startY + h;
      const tz = startZ + dz;
      await moveTo(tx, ty, tz, 4);
      await placeItem('cobblestone', tx, ty, tz);
    }
  }
  for (let x = 0; x < 3; x++) {
    for (let z = 0; z < 3; z++) {
      const tx = startX + x;
      const ty = startY + 2;
      const tz = startZ + z;
      await moveTo(tx, ty, tz, 4);
      await placeItem('cobblestone', tx, ty, tz);
    }
  }
}