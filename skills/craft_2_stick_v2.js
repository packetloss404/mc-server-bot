async function craft2Sticks(bot) {
  const stick = bot.inventory.items().find(item => item.name === 'stick');
  if (stick && stick.count >= 2) {
    return; // Already have at least 2 sticks
  }

  // We have spruce_log x2 - convert to planks first for hand crafting
  await craftItem('spruce_planks', 4);

  // Then craft 2 sticks from the planks
  await craftItem('stick', 2);
}