async function challengeTheStranger(bot) {
  try {
    await challengeStranger(bot);
  } catch (err) {
    bot.chat(`Error: ${err}`);
  }
}