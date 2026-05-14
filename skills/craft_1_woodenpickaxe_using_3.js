async function craft1WoodenPickaxeUsing3OakPlanksAnd2Sticks(bot) {
  // 1. Ensure a crafting table is placed
  let craftingTableBlock = bot.findBlock({
    matching: block => block.name === 'crafting_table',
    maxDistance: 32
  });
  if (!craftingTableBlock) {
    // If no crafting table is found nearby, check inventory
    const craftingTableInInventory = bot.inventory.items().find(item => item.name === 'crafting_table');
    if (craftingTableInInventory) {
      // Place the crafting table
      const refBlock = bot.findBlock({
        matching: block => block.name === 'dirt' || block.name === 'grass_block' || block.name === 'stone',
        maxDistance: 32
      });
      if (!refBlock) { console.log("Block not found"); return; }
      if (refBlock) {
        const placePosition = refBlock.position.offset(0, 1, 0);
        await placeItem('crafting_table', placePosition.x, placePosition.y, placePosition.z);
        craftingTableBlock = bot.findBlock({
          matching: block => block.name === 'crafting_table',
          maxDistance: 32
        }); // Re-find after placing
      } else {
        throw new Error('Could not find a suitable block to place the crafting table on.');
      }
    } else {
      // If no crafting table in inventory or nearby, cannot proceed.
      // The task assumes we have a crafting table or can get one.
      throw new Error('No crafting_table found in inventory or nearby. Cannot craft wooden pickaxe.');
    }
  }

  // 2. Ensure sufficient materials
  // The current inventory already has enough oak_planks (8 > 3) and sticks (16 > 2).
  // No need to collect more.

  // 3. Craft the wooden pickaxe
  await craftItem('wooden_pickaxe', 1);
}