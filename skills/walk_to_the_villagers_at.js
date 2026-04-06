async function walkToVillagers(bot) {
  const getVillager = () => bot.nearestEntity(e => e.name === 'villager' || e.type === 'villager');
  let targetVillager = getVillager();
  if (!targetVillager) {
    await moveTo(854, 64, 67, 5, 60);
    targetVillager = getVillager();
  }
  if (targetVillager) {
    await moveTo(targetVillager.position.x, targetVillager.position.y, targetVillager.position.z, 2, 30);
  } else {
    await moveTo(854, 64, 67, 2, 30);
  }
}