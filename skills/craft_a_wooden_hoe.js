async function craftWoodenHoe(bot) {
  try {
    // 1. Collect spruce logs (2 logs provide 8 planks, enough for everything)
    await mineBlock('spruce_log', 2);

    // 2. Craft planks
    await craftItem('spruce_planks', 8);

    // 3. Craft sticks
    await craftItem('stick', 4);

    // 4. Craft crafting table
    await craftItem('crafting_table', 1);

    // 5. Place the crafting table nearby
    const referenceBlock = bot.findBlock({
      matching: b => b.name !== 'air' && b.name !== 'water' && b.name !== 'lava' && b.boundingBox === 'block',
      maxDistance: 4
    });

    if (referenceBlock) {
      await placeItem('crafting_table', referenceBlock.position.x, referenceBlock.position.y + 1, referenceBlock.position.z);
    } else {
      const pos = bot.entity.position.offset(1, 0, 0).floored();
      await placeItem('crafting_table', pos.x, pos.y, pos.z);
    }

    // 6. Craft the wooden hoe
    await craftItem('wooden_hoe', 1);
  } catch (error) {
    console.error("Error crafting wooden hoe:", error);
  }
}