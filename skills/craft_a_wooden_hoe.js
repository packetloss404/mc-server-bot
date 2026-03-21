async function craftWoodenHoeTask(bot) {
  try {
    await craftAWoodenHoe(bot);
  } catch (err) {
    console.error("Error completing craft wooden hoe task:", err);
  }
}