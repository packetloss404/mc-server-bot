async function craft_1_oak_planks(bot) {
  const inv = bot.inventory.items();
  const oakLog = inv.find(i => i.name === 'oak_log');
  if (!oakLog) {
    throw new Error('No oak log in inventory to craft oak planks');
  }
  await craftItem('oak_planks', 1);
}