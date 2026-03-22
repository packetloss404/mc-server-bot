async function collectThreeOakLogs(bot) {
  const targetName = 'oak_log';
  const targetCount = 3;
  let oakLog = bot.findBlock({
    matching: b => b.name === targetName,
    maxDistance: 32
  });
  if (!oakLog) {
    await exploreUntil('north', 60, () => bot.findBlock({
      matching: b => b.name === targetName,
      maxDistance: 32
    }));
  }
  await mineBlock(targetName, targetCount);
}