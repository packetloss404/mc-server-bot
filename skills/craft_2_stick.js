async function craft2Sticks(bot) {
  const inv = bot.inventory.items();
  const sticks = inv.find(i => i.name === 'stick');
  if (sticks && sticks.count >= 2) {
    return;
  }
  const oakLog = bot.findBlock({
    matching: b => b.name === 'oak_log',
    maxDistance: 32
  });
  if (!oakLog) {
    const pos = bot.entity.position;
    await moveTo(pos.x + 10, pos.y, pos.z + 10, 2, 15);
  }
  await mineBlock('oak_log', 1);
  await craftItem('oak_planks', 4);
  await craftItem('stick', 2);
}