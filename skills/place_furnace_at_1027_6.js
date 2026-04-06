async function placeFurnaceAtTarget(bot) {
  const tx = 1027;
  const ty = 65;
  const tz = 410;
  let furnace = bot.inventory.items().find(i => i.name === 'furnace');
  if (!furnace) {
    const cobble = bot.inventory.items().find(i => i.name === 'cobblestone');
    if (!cobble || cobble.count < 8) {
      await mineBlock('stone', 8);
    }
    await craftItem('furnace', 1);
  }
  await moveTo(tx, ty, tz, 3, 10);
  const targetPos = bot.entity.position.clone();
  targetPos.x = tx;
  targetPos.y = ty;
  targetPos.z = tz;
  const block = bot.blockAt(targetPos);
  if (block && block.name !== 'air' && block.name !== 'furnace') {
    await mineBlock(block.name, 1);
  }
  await placeItem('furnace', tx, ty, tz);
}