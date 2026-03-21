async function walkToTheNearestFarmland(bot) {
  try {
    const findFarmland = () => bot.findBlock({
      matching: block => block.name === 'farmland',
      maxDistance: 32
    });
    let targetBlock = findFarmland();
    if (!targetBlock) {
      targetBlock = await exploreUntil({
        x: 0,
        y: 0,
        z: 1
      }, 60, () => {
        return findFarmland();
      });
    }
    if (targetBlock) {
      const pos = targetBlock.position;
      await moveTo(pos.x, pos.y, pos.z, 1, 30);
    }
  } catch (err) {
    // Silently handle errors
  }
}