async function mine3OakLogs(bot) {
  let oakLogsCount = bot.inventory.items().find(i => i.name === 'oak_log')?.count || 0;

  // Equip a wooden pickaxe if available and not already equipped with a suitable tool
  const woodenPickaxe = bot.inventory.items().find(i => i.name === 'wooden_pickaxe');
  const currentHandItem = bot.heldItem;
  if (woodenPickaxe && (!currentHandItem || !currentHandItem.name.includes('pickaxe'))) {
    await bot.equip(woodenPickaxe, 'hand');
  } else if (!woodenPickaxe) {
    // If no wooden pickaxe, check if there's any pickaxe
    const anyPickaxe = bot.inventory.items().find(i => i.name.includes('pickaxe'));
    if (anyPickaxe && (!currentHandItem || !currentHandItem.name.includes('pickaxe'))) {
      await bot.equip(anyPickaxe, 'hand');
    } else if (!anyPickaxe) {
      // If no pickaxe at all, mining logs might be slow, but the task doesn't specify making one.
      // Continue without a pickaxe, as logs can be mined by hand.
    }
  }
  while (oakLogsCount < 3) {
    let targetOakLog = bot.findBlock({
      matching: b => b.name === 'oak_log',
      maxDistance: 32
    });
    if (!targetOakLog) {
      // If no oak logs are nearby, explore until one is found
      await exploreUntil('forward', 60000, () => {
        // Explore for up to 60 seconds
        return bot.findBlock({
          matching: b => b.name === 'oak_log',
          maxDistance: 32
        });
      });
      targetOakLog = bot.findBlock({
        // Re-check after exploring
        matching: b => b.name === 'oak_log',
        maxDistance: 32
      });
    }
    if (targetOakLog) {
      // Mine one oak log at a time to keep the goal simple and avoid timeout
      await mineBlock('oak_log', 1);
      oakLogsCount = bot.inventory.items().find(i => i.name === 'oak_log')?.count || 0;
    } else {
      // If after exploring and re-checking, no oak log is found, we might be stuck.
      // Break the loop to avoid infinite attempts.
      break;
    }
  }
}