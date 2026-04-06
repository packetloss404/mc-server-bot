async function mine_1_oak_log(bot) {
  const logName = 'oak_log';
  const block = bot.findBlock({
    matching: b => b.name === logName,
    maxDistance: 32
  });
  if (!block) {
    await exploreUntil(bot.entity.yaw, 60, () => {
      return bot.findBlock({
        matching: b => b.name === logName,
        maxDistance: 32
      });
    });
  }
  const initialCount = bot.inventory.items().find(i => i.name === logName)?.count || 0;
  await mineBlock(logName, 1);
  const finalCount = bot.inventory.items().find(i => i.name === logName)?.count || 0;
  if (finalCount <= initialCount) {
    const droppedLog = bot.nearestEntity(e => e.name === 'item' && e.onGround && e.getItemStack().name === logName);
    if (droppedLog) {
      await moveTo(droppedLog.position.x, droppedLog.position.y, droppedLog.position.z, 1, 10);
    }
  }
}