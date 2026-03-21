async function mineNearestOakLog(bot) {
  try {
    await mineTheNearestOakLog(bot);
    bot.chat("Mined 1 oak log.");
  } catch (err) {
    console.error('Error mining oak log:', err);
    bot.chat("Failed to mine oak log.");
  }
}