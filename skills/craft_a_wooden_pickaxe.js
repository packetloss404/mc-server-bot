async function craftWoodenPickaxe(bot) {
  const existingPickaxe = bot.inventory.items().find(i => i.name === 'wooden_pickaxe');
  if (existingPickaxe) return;

  // 1. Ensure we have the necessary materials (3 planks, 2 sticks)
  // Current inventory: spruce_planks x8, stick x8. We are good.

  // 2. Check for a crafting table nearby
  let tableBlock = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });

  // 3. If no table nearby, place the one from inventory
  if (!tableBlock) {
    const tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (!tableItem) {
      // If for some reason we lost it, craft a new one
      await craftOneCraftingTable(bot);
    }

    // Find a solid block to place it on
    const referenceBlock = bot.findBlock({
      matching: b => b.name !== 'air' && b.name !== 'water' && b.name !== 'lava' && b.boundingBox === 'block',
      maxDistance: 4
    });
    if (referenceBlock) {
      const placePos = referenceBlock.position.offset(0, 1, 0);
      await placeItem('crafting_table', placePos.x, placePos.y, placePos.z);
    } else {
      // Fallback placement
      const pos = bot.entity.position.offset(1, 0, 0).floored();
      await placeItem('crafting_table', pos.x, pos.y, pos.z);
    }

    // Re-verify table location
    tableBlock = bot.findBlock({
      matching: b => b.name === 'crafting_table',
      maxDistance: 32
    });
  }

  // 4. Move to the crafting table to ensure we are in range
  if (tableBlock) {
    await moveTo(tableBlock.position.x, tableBlock.position.y, tableBlock.position.z, 3, 10);
  }

  // 5. Craft the wooden pickaxe
  // Note: craftItem handles the table interaction if one is nearby
  await craftItem('wooden_pickaxe', 1);
}