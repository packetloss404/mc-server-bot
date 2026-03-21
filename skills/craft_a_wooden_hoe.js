async function craftWoodenHoeTask(bot) {
  try {
    bot.chat("Gathering materials for a wooden hoe.");
    // We have 1 log and 8 sticks. We need 2 logs total for Table + Hoe.
    await mineBlock("spruce_log", 2);
    await craftItem("spruce_planks", 8);
    
    // Check if we need a crafting table
    const table = bot.inventory.items().find(i => i.name === "crafting_table");
    if (!table) {
      await craftItem("crafting_table", 1);
    }
    
    const pos = bot.entity.position;
    await placeItem("crafting_table", Math.floor(pos.x) + 1, Math.floor(pos.y), Math.floor(pos.z));
    
    await craftItem("wooden_hoe", 1);
    bot.chat("Successfully crafted a wooden hoe!");
  } catch (err) {
    bot.chat("Error crafting hoe: " + err.message);
  }
}