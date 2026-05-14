async function craftOneTorch(bot) {
  // Check if crafting_table is in inventory or placed nearby
  let craftingTable = bot.inventory.items().find(item => item.name === 'crafting_table');
  let craftingTablePos = null;
  if (!craftingTable) {
    craftingTablePos = bot.findBlock({
      matching: b => b.name === 'crafting_table',
      maxDistance: 32
    });
    if (!craftingTablePos) {
      // Need to craft a crafting table first
      // Requires 4 oak_planks. Check inventory for planks.
      const oakPlanks = bot.inventory.items().find(item => item.name === 'oak_planks');
      if (!oakPlanks || oakPlanks.count < 4) {
        // Need to get wood to make planks
        const oakLogs = bot.inventory.items().find(item => item.name === 'oak_log');
        if (!oakLogs || oakLogs.count < 1) {
          await mineBlock('oak_log', 1); // Collect at least 1 oak log
        }
        // Craft planks from logs
        const currentOakLogs = bot.inventory.items().find(item => item.name === 'oak_log');
        if (currentOakLogs) {
          await craftItem('oak_planks', 4); // Craft planks to make a crafting table
        } else {
          throw new Error('Could not obtain oak logs to craft planks for crafting table.');
        }
      }
      // Now craft the crafting table
      await craftItem('crafting_table', 1);
      craftingTable = bot.inventory.items().find(item => item.name === 'crafting_table');
      if (!craftingTable) {
        throw new Error('Failed to craft crafting_table.');
      }
    }
  }

  // If we found a crafting table block, move to it.
  if (craftingTablePos) {
    await moveTo(craftingTablePos.x, craftingTablePos.y, craftingTablePos.z, 1, 10);
  } else if (craftingTable && !craftingTablePos) {
    // If we have a crafting table in inventory but none placed, place one
    // Find a suitable placement position. For simplicity, place it near the bot.
    const refBlock = bot.blockAt(bot.entity.position.offset(0, -1, 0)); // Block below bot
    if (!refBlock || refBlock.name === 'air' || refBlock.name.includes('water') || refBlock.name.includes('lava')) {
      // If below is air/fluid, try a few steps forward/back/side
      const testPositions = [bot.entity.position.offset(0, -1, 0), bot.entity.position.offset(1, -1, 0), bot.entity.position.offset(-1, -1, 0), bot.entity.position.offset(0, -1, 1), bot.entity.position.offset(0, -1, -1)];
      let placed = false;
      for (const pos of testPositions) {
        const blockBelow = bot.blockAt(pos);
        if (blockBelow && blockBelow.name !== 'air' && !blockBelow.name.includes('water') && !blockBelow.name.includes('lava')) {
          const blockAbove = bot.blockAt(pos.offset(0, 1, 0));
          if (blockAbove && blockAbove.name === 'air') {
            await placeItem('crafting_table', pos.x, pos.y + 1, pos.z);
            craftingTablePos = pos.offset(0, 1, 0);
            placed = true;
            break;
          }
        }
      }
      if (!placed) {
        throw new Error('Could not find a suitable place to put the crafting table.');
      }
    } else {
      // Place on top of the block below the bot, if it's not air/fluid
      await placeItem('crafting_table', refBlock.x, refBlock.y + 1, refBlock.z);
      craftingTablePos = refBlock.position.offset(0, 1, 0);
    }
    await moveTo(craftingTablePos.x, craftingTablePos.y, craftingTablePos.z, 1, 10); // Move to the newly placed table
  }

  // Check for coal
  let coal = bot.inventory.items().find(item => item.name === 'coal');
  if (!coal || coal.count < 1) {
    // Try to find coal ore and mine it
    const coalOre = bot.findBlock({
      matching: b => b.name === 'coal_ore',
      maxDistance: 32
    });
    if (!coalOre) { console.log("Block not found"); return; }
    if (coalOre) {
      await mineBlock('coal_ore', 1);
      coal = bot.inventory.items().find(item => item.name === 'coal');
      if (!coal || coal.count < 1) {
        throw new Error('Failed to obtain coal after mining coal_ore.');
      }
    } else {
      throw new Error('No coal in inventory and no nearby coal_ore found.');
    }
  }

  // Check for sticks
  let sticks = bot.inventory.items().find(item => item.name === 'stick');
  if (!sticks || sticks.count < 1) {
    // Need to craft sticks from planks. Requires 2 planks for 4 sticks.
    let oakPlanks = bot.inventory.items().find(item => item.name === 'oak_planks');
    if (!oakPlanks || oakPlanks.count < 2) {
      // Need to get wood to make planks
      const oakLogs = bot.inventory.items().find(item => item.name === 'oak_log');
      if (!oakLogs || oakLogs.count < 1) {
        await mineBlock('oak_log', 1); // Collect at least 1 oak log
      }
      // Craft planks from logs
      const currentOakLogs = bot.inventory.items().find(item => item.name === 'oak_log');
      if (currentOakLogs) {
        await craftItem('oak_planks', 2); // Craft planks to make sticks
      } else {
        throw new Error('Could not obtain oak logs to craft planks for sticks.');
      }
    }
    await craftItem('stick', 1); // Craft 1 stick (recipe yields 4, but we only need 1 for the task)
    sticks = bot.inventory.items().find(item => item.name === 'stick');
    if (!sticks || sticks.count < 1) {
      throw new Error('Failed to craft sticks.');
    }
  }

  // Finally, craft the torch
  await craftItem('torch', 1);
}