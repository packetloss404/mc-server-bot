async function placeTwelveCobblestoneToIncreaseWallHeight(bot) {
  // Build a 12-block tall column starting from the bot's current position.
  // Reusable: anchored to wherever the bot stands.
  const getCobbleCount = () => {
    const item = bot.inventory.items().find(i => i.name === 'cobblestone');
    return item ? item.count : 0;
  };
  if (getCobbleCount() < 12) {
    const stoneBlock = bot.findBlock({ matching: b => b.name === 'stone', maxDistance: 32 });
    if (!stoneBlock) {
      await exploreUntil({ x: 0, y: 0, z: -1 }, 60, () => bot.findBlock({
        matching: b => b.name === 'stone',
        maxDistance: 32
      }));
    }
    await mineBlock('stone', 12 - getCobbleCount());
  }
  const origin = bot.entity.position;
  const tx = Math.floor(origin.x) + 1;
  const tz = Math.floor(origin.z);
  const baseY = Math.floor(origin.y);
  let placed = 0;
  for (let dy = 0; dy < 19 && placed < 12; dy++) {
    const ty = baseY + dy;
    const block = bot.blockAt(bot.entity.position.constructor ? new (bot.entity.position.constructor)(tx, ty, tz) : { x: tx, y: ty, z: tz });
    if (block && (block.name === 'air' || block.name === 'cave_air' || block.name === 'water')) {
      try {
        await placeItem('cobblestone', tx, ty, tz);
        placed++;
      } catch { /* skip unreachable cells */ }
    }
  }
}
