async function craftWoodenHoe(bot) {
  try {
    // 1 log = 4 planks. 
    // Need: 4 planks (crafting table) + 2 planks (sticks) + 2 planks (hoe) = 8 planks.
    // 2 logs is enough, 3 to be safe.
    await mineBlock('oak_log', 3);
    
    // Craft planks
    await craftItem('oak_planks', 3);
    
    // Craft crafting table
    await craftItem('crafting_table', 1);
    
    // Find a suitable position to place the crafting table
    const referenceBlock = bot.findBlock({
      matching: block => block.name !== 'air',
      maxDistance: 4
    });
    
    if (referenceBlock) {
      await placeItem('crafting_table', referenceBlock.position.x, referenceBlock.position.y + 1, referenceBlock.position.z);
    } else {
      // Fallback to current position if no block found
      const pos = bot.entity.position;
      await placeItem('crafting_table', Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
    }
    
    // Craft sticks (yields 4)
    await craftItem('stick', 1);
    
    // Craft the wooden hoe
    await craftItem('wooden_hoe', 1);
  } catch (err) {
    console.error("Error crafting wooden hoe:", err);
  }
}