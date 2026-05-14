async function craftTorches(bot) {
  const requiredCoal = 1;
  const requiredSticks = 1;
  const coalInInventory = bot.inventory.items().find(item => item.name === 'coal');
  const sticksInInventory = bot.inventory.items().find(item => item.name === 'stick');
  if (!coalInInventory || coalInInventory.count < requiredCoal) {
    throw new Error(`Not enough coal in inventory. Need ${requiredCoal}, have ${coalInInventory ? coalInInventory.count : 0}.`);
  }
  if (!sticksInInventory || sticksInInventory.count < requiredSticks) {
    throw new Error(`Not enough sticks in inventory. Need ${requiredSticks}, have ${sticksInInventory ? sticksInInventory.count : 0}.`);
  }

  // Craft 4 torches. The craftItem primitive should handle finding a crafting table or hand crafting if applicable.
  // The recipe for 4 torches is 1 coal and 1 stick.
  await craftItem('torch', 4);
}