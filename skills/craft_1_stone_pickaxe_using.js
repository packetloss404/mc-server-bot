async function craftStonePickaxe(bot) {
  const craftingTablePos = {
    x: 974,
    y: 75,
    z: 375
  };

  // 1. Ensure we have a crafting table placed or in inventory
  let tableBlock = bot.findBlock({
    matching: block => block.name === 'crafting_table',
    maxDistance: 32
  });
  if (!tableBlock) {
    const hasTableInInventory = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (hasTableInInventory) {
      // Place it at the known workstation position or nearby
      await moveTo(craftingTablePos.x, craftingTablePos.y, craftingTablePos.z, 1, 60);
      await placeItem('crafting_table', craftingTablePos.x, craftingTablePos.y, craftingTablePos.z);
      tableBlock = bot.blockAt(bot.entity.position.set(craftingTablePos.x, craftingTablePos.y, craftingTablePos.z));
    } else {
      // If no table, we'd need to craft one, but the prompt says we have materials
      await craftItem('crafting_table', 1);
      const currentPos = bot.entity.position;
      await placeItem('crafting_table', Math.floor(currentPos.x) + 1, Math.floor(currentPos.y), Math.floor(currentPos.z));
      tableBlock = bot.findBlock({
        matching: block => block.name === 'crafting_table',
        maxDistance: 32
      });
    }
  }

  // 2. Move to the crafting table
  if (tableBlock) {
    await moveTo(tableBlock.position.x, tableBlock.position.y, tableBlock.position.z, 1, 60);
  }

  // 3. Craft the stone pickaxe
  // The bot has 3 cobblestone and 2 sticks as per the inventory state
  await craftItem('stone_pickaxe', 1);
}