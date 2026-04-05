async function placeFourTorchesInRoom(bot) {
  const torch = bot.inventory.items().find(i => i.name === 'torch');
  if (!torch || torch.count < 4) {
    const stick = bot.inventory.items().find(i => i.name === 'stick');
    if (!stick) {
      await craftItem('stick', 1);
    }
    await craftItem('torch', 1);
  }
  const roomBase = bot.findBlock({
    matching: b => b.name === 'cobblestone',
    maxDistance: 32
  });
  if (!roomBase) {
    return;
  }
  await moveTo(roomBase.position.x, roomBase.position.y, roomBase.position.z, 2);
  const torchPositions = [roomBase.position.offset(1, 1, 0), roomBase.position.offset(-1, 1, 0), roomBase.position.offset(0, 1, 1), roomBase.position.offset(0, 1, -1)];
  for (const pos of torchPositions) {
    const block = bot.blockAt(pos);
    if (block && (block.name === 'air' || block.name === 'cave_air')) {
      await placeItem('torch', pos.x, pos.y, pos.z);
    }
  }
}