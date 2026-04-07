async function placeFourOakPlanksAtWall(bot) {
  const targetPlanks = 4;
  const targetPositions = [{
    x: 942,
    y: 61,
    z: 358
  }, {
    x: 942,
    y: 61,
    z: 359
  }, {
    x: 942,
    y: 61,
    z: 360
  }, {
    x: 942,
    y: 61,
    z: 361
  }];
  let currentPlanks = bot.inventory.items().filter(i => i.name === 'oak_planks').reduce((acc, i) => acc + i.count, 0);
  if (currentPlanks < targetPlanks) {
    const logs = bot.inventory.items().find(i => i.name === 'oak_log');
    if (logs) {
      await craftItem('oak_planks', 1); // 1 log = 4 planks
    } else {
      await mineBlock('oak_log', 1);
      await craftItem('oak_planks', 1);
    }
  }
  for (let i = 0; i < targetPlanks; i++) {
    const pos = targetPositions[i];
    await moveTo(pos.x, pos.y, pos.z, 4, 10);
    await placeItem('oak_planks', pos.x, pos.y, pos.z);
  }
}