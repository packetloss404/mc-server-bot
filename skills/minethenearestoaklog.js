async function mineTheNearestOakLog(bot) {
  const oakLog = bot.findBlock({
    matching: b => b.name === 'oak_log',
    maxDistance: 32
  });
  if (!oakLog) {
    await exploreUntil("north", 60, () => {
      return bot.findBlock({
        matching: b => b.name === 'oak_log',
        maxDistance: 32
      });
    });
  }
  await mineBlock("oak_log", 1);
}