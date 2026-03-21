async function pointPlayerToNearestForest(bot) {
  try {
    await pointThePlayerTowardsThe(bot);
  } catch (err) {
    console.error('Error in pointPlayerToNearestForest:', err);
    bot.chat('Failed to point to forest.');
  }
}