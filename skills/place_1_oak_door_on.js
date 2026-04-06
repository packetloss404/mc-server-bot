async function placeOakDoorOnCobblestone(bot) {
  let oakDoor = bot.inventory.items().find(i => i.name === 'oak_door');
  if (!oakDoor) {
    let oakPlanks = bot.inventory.items().find(i => i.name === 'oak_planks');
    if (!oakPlanks) {
      let oakLog = bot.inventory.items().find(i => i.name === 'oak_log');
      if (!oakLog) {
        await mineBlock('oak_log', 1);
      }
      await craftItem('oak_planks', 1);
    }
    await craftItem('oak_door', 1);
  }
  const cobbleBlock = bot.findBlock({
    matching: b => b.name === 'cobblestone',
    maxDistance: 32
  });
  if (cobbleBlock) {
    await moveTo(cobbleBlock.position.x, cobbleBlock.position.y, cobbleBlock.position.z, 3);
    await placeItem('oak_door', cobbleBlock.position.x, cobbleBlock.position.y + 1, cobbleBlock.position.z);
  }
}