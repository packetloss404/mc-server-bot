async function craftFourTorchesAtCraftingTable(bot) {
  let coal = bot.inventory.items().find(i => i.name === 'coal' || i.name === 'charcoal');
  if (!coal) {
    const coalOre = bot.findBlock({
      matching: b => b.name === 'coal_ore',
      maxDistance: 32
    });
    if (coalOre) {
      await mineBlock('coal_ore', 1);
    } else {
      await exploreUntil({
        x: 0,
        y: -1,
        z: 0
      }, 60, () => bot.findBlock({
        matching: b => b.name === 'coal_ore',
        maxDistance: 32
      }));
      await mineBlock('coal_ore', 1);
    }
    coal = bot.inventory.items().find(i => i.name === 'coal' || i.name === 'charcoal');
  }
  let sticks = bot.inventory.items().find(i => i.name === 'stick');
  if (!sticks || sticks.count < 1) {
    let planks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
    if (!planks) {
      let logs = bot.inventory.items().find(i => i.name.endsWith('_log'));
      if (!logs) {
        await mineBlock('oak_log', 1);
        logs = bot.inventory.items().find(i => i.name.endsWith('_log'));
      }
      const plankType = logs.name.replace('_log', '_planks');
      await craftItem(plankType, 1);
      planks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
    }
    await craftItem('stick', 1);
    sticks = bot.inventory.items().find(i => i.name === 'stick');
  }
  let tableBlock = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!tableBlock) {
    let existingTable = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (!existingTable) {
      await craftItem('crafting_table', 1);
    }
    const pos = bot.entity.position;
    await placeItem('crafting_table', Math.floor(pos.x) + 1, Math.floor(pos.y), Math.floor(pos.z));
    tableBlock = bot.findBlock({ matching: b => b.name === 'crafting_table', maxDistance: 8 });
  }
  if (tableBlock) {
    await moveTo(tableBlock.position.x, tableBlock.position.y, tableBlock.position.z, 3, 30);
  }
  await craftItem('torch', 1);
}