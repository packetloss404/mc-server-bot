async function retrieveStonecutterFromChest(bot) {
  const chestBlock = bot.findBlock({ matching: b => b.name === 'chest', maxDistance: 64 });
  if (!chestBlock) return;
  await moveTo(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 2, 60);
  try { await withdrawItem('chest', 'stonecutter', 1); } catch { /* may not contain item */ }
}
