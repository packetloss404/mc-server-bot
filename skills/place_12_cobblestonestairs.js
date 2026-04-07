async function place12CobblestoneStairs(bot) {
  const startX = 1028;
  const startY = 67;
  const startZ = 411;
  for (let i = 0; i < 12; i++) {
    const currentX = startX + i;
    const stairs = bot.inventory.items().find(item => item.name === 'cobblestone_stairs');
    if (!stairs) break;
    await moveTo(currentX, startY, startZ, 3, 10);
    await placeItem('cobblestone_stairs', currentX, startY, startZ);
  }
}