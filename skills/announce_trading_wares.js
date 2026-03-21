async function announceTradingWares(bot) {
  try {
    await announceWares(bot);
  } catch (err) {
    bot.chat(`Error announcing wares: ${err}`);
  }
}