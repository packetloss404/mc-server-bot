async function explore100BlocksToTheWest(bot) {
  const startX = bot.entity.position.x;
  const targetX = startX - 100;
  await exploreUntil({
    x: -1,
    y: 0,
    z: 0
  }, 200, () => bot.entity.position.x <= targetX);
}