async function place12CobblestoneStairs(bot) {
  const targetCount = 12;
  const getStairs = () => bot.inventory.items().find(i => i.name === 'cobblestone_stairs');
  let stairsItem = getStairs();
  const currentCount = stairsItem ? stairsItem.count : 0;
  if (currentCount < targetCount) {
    await craftItem('cobblestone_stairs', targetCount - currentCount);
  }
  const basePos = bot.entity.position.floored();
  let placed = 0;
  for (let x = -3; x <= 3 && placed < targetCount; x++) {
    for (let z = -3; z <= 3 && placed < targetCount; z++) {
      for (let y = -1; y <= 1 && placed < targetCount; y++) {
        const p = basePos.offset(x, y, z);
        const block = bot.blockAt(p);
        const below = bot.blockAt(p.offset(0, -1, 0));
        const botPos = bot.entity.position.floored();
        if (p.equals(botPos) || p.equals(botPos.offset(0, 1, 0))) continue;
        if (block && block.name === 'air' && below && below.name !== 'air' && below.name !== 'water' && below.name !== 'lava' && !below.name.includes('stairs') && below.name !== 'chest' && below.name !== 'crafting_table' && below.name !== 'furnace') {
          await placeItem('cobblestone_stairs', p.x, p.y, p.z);
          placed++;
          await bot.waitForTicks(2);
        }
      }
    }
  }
}