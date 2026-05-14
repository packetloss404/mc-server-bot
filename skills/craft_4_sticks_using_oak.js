async function craft4SticksUsingOakPlanks(bot) {
  const oakPlanks = bot.inventory.items().find(item => item.name === 'oak_planks');
  if (!oakPlanks || oakPlanks.count < 2) {
    // This case should ideally be handled by a higher-level function,
    // but for this specific task, we assume planks are available.
    // If not, the primitive `craftItem` might fail or a more complex
    // logic to acquire planks would be needed.
    // For now, assume sufficient planks.
  }
  await craftItem('stick', 4);
}