async function place12CobblestoneStairs(bot) {
  const targetCount = 12;
  const stairsItem = bot.inventory.items().find(i => i.name === 'cobblestone_stairs');
  const currentStairsCount = stairsItem ? stairsItem.count : 0;
  if (currentStairsCount < targetCount) {
    await craftItem('cobblestone_stairs', targetCount - currentStairsCount);
  }
  let placedCount = 0;
  const startPos = bot.entity.position.floored();
  for (let x = -5; x <= 5 && placedCount < targetCount; x++) {
    for (let z = -5; z <= 5 && placedCount < targetCount; z++) {
      for (let y = -1; y <= 1 && placedCount < targetCount; y++) {
        const targetPos = startPos.offset(x, y, z);
        const block = bot.blockAt(targetPos);
        const ground = bot.blockAt(targetPos.offset(0, -1, 0));
        if (block && block.name === 'air' && ground && ground.name !== 'air' && !ground.name.includes('stairs') && ground.name !== 'water' && ground.name !== 'lava' && ground.name !== 'chest' && ground.name !== 'crafting_table') {
          const botPos = bot.entity.position.floored();
          if (targetPos.equals(botPos) || targetPos.equals(botPos.offset(0, 1, 0))) continue;
          await moveTo(targetPos.x, targetPos.y, targetPos.z, 4);
          const checkBlock = bot.blockAt(targetPos);
          if (checkBlock && checkBlock.name === 'air') {
            await placeItem('cobblestone_stairs', targetPos.x, targetPos.y, targetPos.z);
            placedCount++;
            await bot.waitForTicks(5);
          }
        }
      }
    }
  }
}