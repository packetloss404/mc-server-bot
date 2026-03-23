async function placeOneDirtBlock(bot) {
  const dirtItem = bot.inventory.items().find(i => i.name === 'dirt');
  if (!dirtItem) {
    await mineFiveDirtBlocks(bot);
  }
  const targetPos = bot.entity.position.offset(1, 0, 0);
  const x = Math.floor(targetPos.x);
  const y = Math.floor(targetPos.y);
  const z = Math.floor(targetPos.z);
  await placeItem('dirt', x, y, z);
}