async function collectItemsFromChest(bot) {
  const chestBlock = bot.findBlock({ matching: b => b.name === 'chest', maxDistance: 64 });
  if (!chestBlock) return;
  await moveTo(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 2, 60);
  try { await withdrawItem('chest', 'wooden_pickaxe', 1); } catch { /* may not contain item */ }
  try { await withdrawItem('chest', 'oak_door', 2); } catch { /* may not contain item */ }
}
