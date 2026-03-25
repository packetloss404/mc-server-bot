async function craftStonePickaxe(bot) {
  const existingPickaxe = bot.inventory.items().find(i => i.name === 'stone_pickaxe');
  if (existingPickaxe) return;
  const woodenPickaxe = bot.inventory.items().find(i => i.name === 'wooden_pickaxe');
  if (!woodenPickaxe) {
    const sticks = bot.inventory.items().find(i => i.name === 'stick');
    const planks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
    if (!planks || planks.count < 3 || !sticks || sticks.count < 2) {
      await mineBlock('oak_log', 1);
      const log = bot.inventory.items().find(i => i.name.endsWith('_log'));
      await craftItem(log.name.replace('_log', '_planks'), 1);
    }
    const updatedPlanks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
    const updatedSticks = bot.inventory.items().find(i => i.name === 'stick');
    if (!updatedSticks || updatedSticks.count < 2) {
      await craftItem('stick', 1);
    }
    let table = bot.findBlock({
      matching: b => b.name === 'crafting_table',
      maxDistance: 32
    });
    if (!table) {
      const tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
      if (tableItem) {
        await placeItem('crafting_table', bot.entity.position.offset(1, 0, 0));
        table = bot.findBlock({
          matching: b => b.name === 'crafting_table',
          maxDistance: 32
        });
      } else {
        await craftItem('crafting_table', 1);
        await placeItem('crafting_table', bot.entity.position.offset(1, 0, 0));
        table = bot.findBlock({
          matching: b => b.name === 'crafting_table',
          maxDistance: 32
        });
      }
    }
    await craftItem('wooden_pickaxe', 1);
  }
  const cobblestone = bot.inventory.items().find(i => i.name === 'cobblestone');
  if (!cobblestone || cobblestone.count < 3) {
    await mineBlock('stone', 3);
  }
  const finalSticks = bot.inventory.items().find(i => i.name === 'stick');
  if (!finalSticks || finalSticks.count < 2) {
    const planksForSticks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
    if (!planksForSticks) {
      await mineBlock('oak_log', 1);
      const log = bot.inventory.items().find(i => i.name.endsWith('_log'));
      await craftItem(log.name.replace('_log', '_planks'), 1);
    }
    await craftItem('stick', 1);
  }
  let table = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!table) {
    const tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (tableItem) {
      await placeItem('crafting_table', bot.entity.position.offset(1, 0, 0));
    } else {
      await craftItem('crafting_table', 1);
      await placeItem('crafting_table', bot.entity.position.offset(1, 0, 0));
    }
  }
  await craftItem('stone_pickaxe', 1);
}