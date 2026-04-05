async function craftThirtyTwoOakPlanks(bot) {
  const target = 32;
  const plankName = 'oak_planks';
  const logName = 'oak_log';
  const getPlankCount = () => bot.inventory.items().find(i => i.name === plankName)?.count || 0;
  const getLogCount = () => bot.inventory.items().find(i => i.name === logName)?.count || 0;
  if (getPlankCount() >= target) return;
  const neededLogs = Math.ceil((target - getPlankCount()) / 4);
  const logsToMine = neededLogs - getLogCount();
  if (logsToMine > 0) {
    const findLog = () => bot.findBlock({
      matching: b => b.name === logName,
      maxDistance: 32
    });
    if (!findLog()) {
      await exploreUntil({
        x: 0,
        y: 0,
        z: -1
      }, 60, () => findLog());
    }
    await mineBlock(logName, logsToMine);
  }
  const currentPlanks = getPlankCount();
  if (currentPlanks < target) {
    await craftItem(plankName, target - currentPlanks);
  }
}