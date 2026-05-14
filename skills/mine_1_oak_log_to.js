async function mine1OakLogToGatherMaterialsForACraftingTable(bot) {
  const oakLog = bot.inventory.items().find(i => i.name === 'oak_log');
  if (oakLog && oakLog.count >= 1) {
    return; // Already have enough oak logs
  }
  await mineBlock('oak_log', 1);
}