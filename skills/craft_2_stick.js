async function craft2Sticks(bot) {
  // Check if we already have at least 2 sticks
  const sticks = bot.inventory.items().find(item => item.name === 'stick');
  if (sticks && sticks.count >= 2) {
    return; // Already have 2+ sticks
  }

  // We need planks for sticks. 2 planks make 4 sticks at a crafting table.
  // Place crafting table if not already placed, then craft sticks.
  const craftingTable = bot.inventory.items().find(item => item.name === 'crafting_table');
  const planks = bot.inventory.items().find(item => item.name.includes('_planks'));
  if (!planks || planks.count < 2) {
    // Not enough planks - this shouldn't happen given inventory
    return;
  }

  // Place crafting table nearby
  if (craftingTable) {
    const pos = bot.entity.position;
    await placeItem('crafting_table', Math.floor(pos.x) + 2, Math.floor(pos.y) - 1, Math.floor(pos.z));
  }

  // Craft 4 sticks using crafting table (uses 2 planks)
  await craftItem('stick', 4);
}