async function obtainStick(bot) {
  // Get current stick count
  const initialStick = bot.inventory.items().find(i => i.name === 'stick');
  const initialStickCount = initialStick ? initialStick.count : 0;

  // The task is to "obtain a stick", implying we need to increase the count.
  // We will craft one stick. craftItem will handle obtaining oak_planks if needed.
  await craftItem('stick', 1);

  // Verify that the stick count has increased
  const finalStick = bot.inventory.items().find(i => i.name === 'stick');
  const finalStickCount = finalStick ? finalStick.count : 0;
  if (finalStickCount <= initialStickCount) {
    // If crafting didn't increase the count, it means we likely didn't have enough materials
    // or something went wrong. The craftItem primitive should handle material gathering,
    // but if it fails, we need to explicitly try to get planks first.
    // This part is mostly defensive, as craftItem is supposed to be robust.
    await obtainOakplanks(bot);
    await craftItem('stick', 1); // Try crafting again after ensuring planks
  }
}