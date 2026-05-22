async function mine_3_oak_logs(bot) {
  const oakLogBlock = bot.findBlock({
    matching: b => b.name === 'oak_log',
    maxDistance: 32
  });
  if (!oakLogBlock) { console.log("Block not found"); return; }
  if (oakLogBlock) {
    await mineBlock('oak_log', 3);
  } else {
    await exploreUntil('north', 30, () => bot.findBlock({
      matching: b => b.name === 'oak_log',
      maxDistance: 32
    }));
    await mineBlock('oak_log', 3);
  }
}