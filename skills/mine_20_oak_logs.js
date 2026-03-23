async function mine20OakLogs(bot) {
  let oakLogs = bot.inventory.items().find(i => i.name === 'oak_log');
  let count = oakLogs ? oakLogs.count : 0;
  if (count < 20) {
    await exploreUntil(new Vec3(1, 0, 1), 60000, () => bot.findBlock({
      matching: b => b.name === 'oak_log',
      maxDistance: 32
    }));
    await mineBlock('oak_log', 20 - count);
  }
}