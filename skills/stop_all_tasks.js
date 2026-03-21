async function stopAllTasks(bot) {
  try {
    if (bot.pathfinder) {
      bot.pathfinder.setGoal(null);
    }
  } catch (err) {
    // Silently handle potential errors
  }
}