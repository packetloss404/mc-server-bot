async function retrieveCobblestoneFromChest(bot) {
  const chestPos = {
    x: 949,
    y: 69,
    z: 362
  };
  await moveTo(chestPos.x, chestPos.y, chestPos.z, 1, 60);
  const chestBlock = bot.findBlock({
    matching: b => b.name === 'chest',
    maxDistance: 32
  });
  if (chestBlock) {
    await bot.lookAt(chestBlock.position);
    await inspectContainer('chest');
    await withdrawItem('chest', 'cobblestone', 49);
  }
}