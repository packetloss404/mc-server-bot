async function mineThreeOakLogsAtTaskLocation(bot) {
  const targetName = 'oak_log';
  const targetCount = 3;
  const targetPos = {
    x: 859,
    y: 77,
    z: 217
  };
  const getCount = () => {
    const item = bot.inventory.items().find(i => i.name === targetName);
    return item ? item.count : 0;
  };
  const initialCount = getCount();

  // Move to the specific location mentioned in the task
  await moveTo(targetPos.x, targetPos.y, targetPos.z, 3, 30);

  // Mine the oak logs. mineBlock will find the nearest ones, 
  // which should be at the current location.
  await mineBlock(targetName, targetCount);

  // Confirm target item count increased
  const currentCount = getCount();
  if (currentCount < initialCount + targetCount) {
    const remaining = initialCount + targetCount - currentCount;
    await mineBlock(targetName, remaining);
  }
}