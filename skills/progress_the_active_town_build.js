async function progressTheActiveTownBuild(bot) {
  const inv = bot.inventory.items();
  const oakLogs = inv.find(i => i.name === 'oak_log');
  const planks = inv.find(i => i.name === 'oak_planks');
  const sticks = inv.find(i => i.name === 'stick');

  // Craft oak planks from available logs
  if (oakLogs && oakLogs.count >= 4 && !planks) {
    await craftItem('oak_planks', 16);
  }

  // Craft sticks from planks
  if (!sticks || sticks.count < 4) {
    const updatedPlanks = bot.inventory.items().find(i => i.name === 'oak_planks');
    if (updatedPlanks && updatedPlanks.count >= 2) {
      await craftItem('stick', 8);
    }
  }

  // Get updated inventory after crafting
  const finalInv = bot.inventory.items();
  const finalPlanks = finalInv.find(i => i.name === 'oak_planks');
  const finalSticks = finalInv.find(i => i.name === 'stick');

  // Place oak planks to form a foundation/platform for town build
  if (finalPlanks && finalPlanks.count >= 4) {
    const pos = bot.entity.position;
    const targetX = Math.floor(pos.x) + 2;
    const targetY = Math.floor(pos.y);
    const targetZ = Math.floor(pos.z);
    await placeItem('oak_planks', targetX, targetY, targetZ);
    await placeItem('oak_planks', targetX + 1, targetY, targetZ);
    await placeItem('oak_planks', targetX, targetY, targetZ + 1);
    await placeItem('oak_planks', targetX + 1, targetY, targetZ + 1);
  }
}