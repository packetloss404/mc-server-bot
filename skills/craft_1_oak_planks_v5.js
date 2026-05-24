async function craft_1_oak_planks(bot) {
  const inv = bot.inventory.items();
  const oakLog = inv.find(i => i.name === 'oak_log');
  if (!oakLog) {
    await mineBlock('oak_log', 1);
  }
  await craftItem('oak_planks', 1);
}