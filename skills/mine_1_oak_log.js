async function mineOneOakLog(bot) {
  const targetLog = bot.findBlock({
    matching: block => block.name === 'oak_log',
    maxDistance: 32
  });
  if (targetLog) {
    await moveTo(targetLog.position.x, targetLog.position.y, targetLog.position.z, 2);
  } else {
    await exploreUntil('north', 60, () => bot.findBlock({
      matching: block => block.name === 'oak_log',
      maxDistance: 32
    }));
  }
  await mineBlock('oak_log', 1);
}