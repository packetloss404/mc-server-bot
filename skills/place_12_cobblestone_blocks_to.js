async function placeTwelveCobblestoneToIncreaseWallHeight(bot) {
  const getCobbleCount = () => {
    const item = bot.inventory.items().find(i => i.name === 'cobblestone');
    return item ? item.count : 0;
  };
  if (getCobbleCount() < 12) {
    const stoneBlock = bot.findBlock({
      matching: b => b.name === 'stone',
      maxDistance: 32
    });
    if (!stoneBlock) {
      await exploreUntil('north', 60, () => bot.findBlock({
        matching: b => b.name === 'stone',
        maxDistance: 32
      }));
    }
    await mineBlock('stone', 12 - getCobbleCount());
  }
  let placed = 0;
  const tx = 984;
  const Vec3 = bot.entity.position.constructor;
  for (let ty = 71; ty < 90; ty++) {
    for (let tz = 369; tz <= 372; tz++) {
      if (placed >= 12) break;
      const targetPos = new Vec3(tx, ty, tz);
      const block = bot.blockAt(targetPos);
      if (block && (block.name === 'air' || block.name === 'cave_air' || block.name === 'water')) {
        await placeItem('cobblestone', tx, ty, tz);
        placed++;
      }
    }
    if (placed >= 12) break;
  }
}