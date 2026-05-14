async function craftAWoodenShovel(bot) {
  // Check if wooden shovel is already in inventory
  const woodenShovel = bot.inventory.items().find(item => item.name === 'wooden_shovel');
  if (woodenShovel) {
    return; // Already have a wooden shovel
  }

  // Define required materials for a wooden shovel: 1 stick, 2 planks
  const requiredSticks = 1;
  const requiredPlanks = 2;

  // Check for sticks
  let sticks = bot.inventory.items().find(item => item.name === 'stick');
  if (!sticks || sticks.count < requiredSticks) {
    // Need to craft sticks. Sticks are crafted from planks (2 sticks per 1 plank).
    // We need 1 stick, so 1 plank is sufficient to make 2 sticks.
    let availablePlanks = bot.inventory.items().find(item => item.name.endsWith('_planks'));
    if (!availablePlanks || availablePlanks.count < 1) {
      // Need at least 1 plank to make sticks
      // Check for logs to craft planks
      let oakLogs = bot.inventory.items().find(item => item.name === 'oak_log');
      let birchLogs = bot.inventory.items().find(item => item.name === 'birch_log');
      let spruceLogs = bot.inventory.items().find(item => item.name === 'spruce_log');
      let jungleLogs = bot.inventory.items().find(item => item.name === 'jungle_log');
      let acaciaLogs = bot.inventory.items().find(item => item.name === 'acacia_log');
      let darkOakLogs = bot.inventory.items().find(item => item.name === 'dark_oak_log');
      if (!oakLogs && !birchLogs && !spruceLogs && !jungleLogs && !acaciaLogs && !darkOakLogs) {
        // No logs in inventory, need to mine some
        await mineBlock('oak_log', 1); // Mine at least one log
        oakLogs = bot.inventory.items().find(item => item.name === 'oak_log'); // Recheck after mining
        if (!oakLogs) {
          // If still no logs, something went wrong, cannot proceed
          throw new Error('Could not find or mine any logs to craft planks for sticks.');
        }
      }

      // If we have logs, craft planks
      availablePlanks = bot.inventory.items().find(item => item.name.endsWith('_planks'));
      if (!availablePlanks || availablePlanks.count < 1) {
        if (oakLogs && oakLogs.count > 0) {
          await craftItem('oak_planks', 1); // Craft 1 plank from 1 log
        } else if (birchLogs && birchLogs.count > 0) {
          await craftItem('birch_planks', 1);
        } else if (spruceLogs && spruceLogs.count > 0) {
          await craftItem('spruce_planks', 1);
        } else if (jungleLogs && jungleLogs.count > 0) {
          await craftItem('jungle_planks', 1);
        } else if (acaciaLogs && acaciaLogs.count > 0) {
          await craftItem('acacia_planks', 1);
        } else if (darkOakLogs && darkOakLogs.count > 0) {
          await craftItem('dark_oak_planks', 1);
        }
        availablePlanks = bot.inventory.items().find(item => item.name.endsWith('_planks')); // Recheck after crafting
        if (!availablePlanks || availablePlanks.count < 1) {
          throw new Error('Failed to craft planks from available logs.');
        }
      }
    }
    // Craft sticks from planks
    await craftItem('stick', requiredSticks);
    sticks = bot.inventory.items().find(item => item.name === 'stick');
    if (!sticks || sticks.count < requiredSticks) {
      throw new Error('Failed to craft required sticks.');
    }
  }

  // Check for planks for the shovel head
  let planks = bot.inventory.items().find(item => item.name.endsWith('_planks'));
  if (!planks || planks.count < requiredPlanks) {
    // Need to craft more planks. Each log makes 4 planks.
    // We need 'requiredPlanks' - 'planks.count' planks.
    const planksNeeded = requiredPlanks - (planks ? planks.count : 0);
    const logsToMine = Math.ceil(planksNeeded / 4); // Each log gives 4 planks

    // Check for logs in inventory
    let oakLogs = bot.inventory.items().find(item => item.name === 'oak_log');
    let birchLogs = bot.inventory.items().find(item => item.name === 'birch_log');
    let spruceLogs = bot.inventory.items().find(item => item.name === 'spruce_log');
    let jungleLogs = bot.inventory.items().find(item => item.name === 'jungle_log');
    let acaciaLogs = bot.inventory.items().find(item => item.name === 'acacia_log');
    let darkOakLogs = bot.inventory.items().find(item => item.name === 'dark_oak_log');
    let totalLogs = (oakLogs ? oakLogs.count : 0) + (birchLogs ? birchLogs.count : 0) + (spruceLogs ? spruceLogs.count : 0) + (jungleLogs ? jungleLogs.count : 0) + (acaciaLogs ? acaciaLogs.count : 0) + (darkOakLogs ? darkOakLogs.count : 0);
    if (totalLogs < logsToMine) {
      await mineBlock('oak_log', logsToMine - totalLogs); // Mine enough logs
    }
    // Craft planks from available logs (will use any type of log)
    await craftItem('oak_planks', planksNeeded); // Craft the required planks (will use any log)
    planks = bot.inventory.items().find(item => item.name.endsWith('_planks')); // Recheck after crafting
    if (!planks || planks.count < requiredPlanks) {
      throw new Error('Failed to craft required planks for the shovel head.');
    }
  }

  // Ensure a crafting table is available and reachable
  let craftingTable = bot.inventory.items().find(item => item.name === 'crafting_table');
  if (!craftingTable) {
    // If no crafting table in inventory, craft one
    await craftItem('crafting_table', 1);
    craftingTable = bot.inventory.items().find(item => item.name === 'crafting_table');
    if (!craftingTable) {
      throw new Error('Failed to craft a crafting table.');
    }
  }
  let nearbyCraftingTable = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!nearbyCraftingTable) {
    // If no crafting table nearby, place the one from inventory
    const refBlock = bot.blockAt(bot.entity.position.offset(0, -1, 0)); // Block below bot
    if (!refBlock || refBlock.name === 'air' || refBlock.name.includes('water') || refBlock.name.includes('lava')) {
      // If no solid block below, try to find a suitable placement spot
      const targetPos = bot.entity.position.offset(0, 0, 1); // Try placing in front
      await placeItem('crafting_table', targetPos.x, targetPos.y, targetPos.z);
    } else {
      // Place on top of the block below the bot
      await placeItem('crafting_table', bot.entity.position.x, bot.entity.position.y, bot.entity.position.z);
    }
    nearbyCraftingTable = bot.findBlock({
      matching: b => b.name === 'crafting_table',
      maxDistance: 32
    });
    if (!nearbyCraftingTable) {
      throw new Error('Failed to place crafting table.');
    }
  }

  // Move to the crafting table before attempting to craft
  await moveTo(nearbyCraftingTable.position.x, nearbyCraftingTable.position.y + 1, nearbyCraftingTable.position.z, 1, 10);

  // Now craft the wooden shovel
  await craftItem('wooden_shovel', 1);
}