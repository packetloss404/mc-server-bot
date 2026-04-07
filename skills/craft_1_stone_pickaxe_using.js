async function craftStonePickaxe(bot) {
  // Find or place a crafting table near the bot's current position
  let tableBlock = bot.findBlock({
    matching: block => block.name === 'crafting_table',
    maxDistance: 32
  });
  if (!tableBlock) {
    const hasTableInInventory = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (!hasTableInInventory) {
      await craftItem('crafting_table', 1);
    }
    const currentPos = bot.entity.position;
    await placeItem('crafting_table', Math.floor(currentPos.x) + 1, Math.floor(currentPos.y), Math.floor(currentPos.z));
    tableBlock = bot.findBlock({
      matching: block => block.name === 'crafting_table',
      maxDistance: 8
    });
  }

  // 2. Move to the crafting table
  if (tableBlock) {
    await moveTo(tableBlock.position.x, tableBlock.position.y, tableBlock.position.z, 1, 60);
  }

  // 3. Craft the stone pickaxe
  // The bot has 3 cobblestone and 2 sticks as per the inventory state
  await craftItem('stone_pickaxe', 1);
}