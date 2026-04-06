async function explore100BlocksWest(bot) {
  const startX = bot.entity.position.x;
  const targetX = startX - 100;
  await exploreUntil({
    x: -1,
    y: 0,
    z: 0
  }, 300, () => bot.entity.position.x <= targetX);
}