async function goBackToSurface(bot) {
  const targetY = 64;
  await moveTo(bot.entity.position.x, targetY, bot.entity.position.z, 2, 120);
}