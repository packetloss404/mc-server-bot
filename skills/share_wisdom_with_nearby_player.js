async function approachAndShareWisdom(bot) {
  try {
    await walkToNearestPlayer(bot);
    await lookAtNearestPlayer(bot);
    await shareWisdom(bot);
  } catch (err) {
    console.error('Error sharing wisdom:', err);
    bot.chat('I encountered an error while trying to share wisdom.');
  }
}