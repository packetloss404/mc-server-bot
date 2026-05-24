async function mine1OakLog(bot) {
  const oakLogBlock = bot.findBlock({
    matching: b => b.name === 'oak_log',
    maxDistance: 32
  });
  if (!oakLogBlock) { console.log("Block not found"); return; }
  if (oakLogBlock) {
    await mineBlock('oak_log', 1);
  } else {
    await exploreUntil('north', 15, () => bot.findBlock({
      matching: b => b.name === 'oak_log',
      maxDistance: 32
    }));
    const nearbyOakLog = bot.findBlock({
      matching: b => b.name === 'oak_log',
      maxDistance: 32
    });
    if (!nearbyOakLog) { console.log("Block not found"); return; }
    if (nearbyOakLog) {
      await mineBlock('oak_log', 1);
    }
  }
}