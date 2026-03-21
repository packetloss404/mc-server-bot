async function findNearestWater(bot) {
  try {
    await findWaterSource(bot);
  } catch (err) {
    bot.chat(`Error finding water: ${err}`);
  }
}