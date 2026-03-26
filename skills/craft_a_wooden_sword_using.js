async function craftWoodenSwordAtTable(bot) {
  // 1. Ensure we have oak_planks (need 2)
  let planks = bot.inventory.items().find(i => i.name === 'oak_planks');
  let planksCount = planks ? planks.count : 0;
  if (planksCount < 2) {
    let logs = bot.inventory.items().find(i => i.name === 'oak_log');
    if (!logs) {
      await mineBlock('oak_log', 1);
    }
    await craftItem('oak_planks', 1);
  }

  // 2. Ensure we have a stick (need 1)
  let stick = bot.inventory.items().find(i => i.name === 'stick');
  if (!stick) {
    // If no sticks, we need more planks to craft them (2 planks -> 4 sticks)
    let currentPlanks = bot.inventory.items().find(i => i.name === 'oak_planks');
    if (!currentPlanks || currentPlanks.count < 2) {
      await mineBlock('oak_log', 1);
      await craftItem('oak_planks', 1);
    }
    await craftItem('stick', 1);
  }

  // 3. Ensure crafting table is placed
  let tableBlock = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!tableBlock) {
    let tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (!tableItem) {
      // Use the provided logic or simplified version to get a table
      let currentPlanks = bot.inventory.items().find(i => i.name === 'oak_planks');
      if (!currentPlanks || currentPlanks.count < 4) {
        await mineBlock('oak_log', 1);
        await craftItem('oak_planks', 1);
      }
      await craftItem('crafting_table', 1);
    }
    // Place the table near the bot's current position
    await placeItem('crafting_table', Math.floor(bot.entity.position.x) + 1, Math.floor(bot.entity.position.y), Math.floor(bot.entity.position.z));
    tableBlock = bot.findBlock({
      matching: b => b.name === 'crafting_table',
      maxDistance: 32
    });
  }

  // 4. Move to the crafting table
  await moveTo(tableBlock.position.x, tableBlock.position.y, tableBlock.position.z, 3, 10);

  // 5. Final check for materials before crafting
  planks = bot.inventory.items().find(i => i.name === 'oak_planks');
  stick = bot.inventory.items().find(i => i.name === 'stick');
  if (planks && planks.count >= 2 && stick && stick.count >= 1) {
    await craftItem('wooden_sword', 1);
  }
}