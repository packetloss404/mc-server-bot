async function approachCrisisAct(bot) {
  const players = Object.values(bot.players).filter(p => p.entity);
  let target = players.find(p => p.username === 'CrisisAct');
  if (!target || !target.entity) {
    console.log('CrisisAct not found nearby, exploring...');
    target = await exploreUntil('forward', 30, () => {
      const found = Object.values(bot.players).find(p => p.username === 'CrisisAct' && p.entity);
      return found ? found.entity.position : null;
    });
    if (!target) {
      console.log('CrisisAct not found after exploration');
      return;
    }
  }
  const targetPos = target.entity.position;
  await moveTo(targetPos.x, targetPos.y, targetPos.z, 3, 15);
  console.log('Approached CrisisAct to melee range');
}