async function craft4MoreTorchesUsing1CoalAnd8Sticks(bot) {
  // Check if we have a crafting table
  let craftingTable = bot.inventory.items().find(item => item.name === 'crafting_table');
  if (!craftingTable) {
    // Check for oak planks to craft a crafting table
    let oakPlanks = bot.inventory.items().find(item => item.name === 'oak_planks');
    if (!oakPlanks || oakPlanks.count < 4) {
      // If not enough planks, get some oak logs
      let oakLogs = bot.inventory.items().find(item => item.name === 'oak_log');
      if (!oakLogs || oakLogs.count < 1) {
        await mineBlock('oak_log', 1); // Mine 1 oak log
      }
      await craftItem('oak_planks', 4); // Craft 4 planks from 1 log
    }
    await craftItem('crafting_table', 1); // Craft the crafting table
  }

  // Ensure we have 1 coal
  let coal = bot.inventory.items().find(item => item.name === 'coal');
  if (!coal || coal.count < 1) {
    // If no coal, mine some coal ore
    const coalOre = bot.findBlock({
      matching: b => b.name === 'coal_ore',
      maxDistance: 32
    });
    if (!coalOre) {
      throw new Error('No coal ore found nearby to mine.');
    }
    await mineBlock('coal_ore', 1);
  }

  // Ensure we have at least 1 stick (task specifies 8, but recipe only needs 1 for 4 torches)
  let sticks = bot.inventory.items().find(item => item.name === 'stick');
  if (!sticks || sticks.count < 1) {
    // If no sticks, craft some from planks
    let oakPlanks = bot.inventory.items().find(item => item.name === 'oak_planks');
    if (!oakPlanks || oakPlanks.count < 1) {
      // Need 1 plank for 4 sticks
      let oakLogs = bot.inventory.items().find(item => item.name === 'oak_log');
      if (!oakLogs || oakLogs.count < 1) {
        await mineBlock('oak_log', 1);
      }
      await craftItem('oak_planks', 1); // Craft 1 plank
    }
    await craftItem('stick', 4); // Craft 4 sticks from 1 plank
  }

  // Craft 4 torches. The recipe takes 1 coal and 1 stick to make 4 torches.
  await craftItem('torch', 4);
}