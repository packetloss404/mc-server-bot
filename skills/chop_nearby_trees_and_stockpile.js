async function chopNearbyTreesAndStockpileLogs(bot) {
  // Check if we're in water and need to get to shore first
  const blockBelow = bot.blockAt(bot.entity.position.offset(0, -1, 0));
  if (blockBelow && (blockBelow.name === 'water' || blockBelow.name === 'flowing_water')) {
    await walkToTheNearestShore(bot);
  }

  // Find nearby oak log blocks using findBlock (singular)
  let oakLog = bot.findBlock({
    matching: b => b.name === 'oak_log',
    maxDistance: 32
  });
  if (!oakLog) {
    console.log("No oak logs found nearby, exploring...");
    oakLog = await exploreUntil('north', 15, () => bot.findBlock({
      matching: b => b.name === 'oak_log',
      maxDistance: 32
    }));
  }
  if (!oakLog) {
    console.log("Still no oak logs found after exploring");
    return;
  }

  // Mine oak logs
  await mineBlock('oak_log', 32);
}