async function craftOneOakBoat(bot) {
  const boatName = 'oak_boat';
  const existingBoat = bot.inventory.items().find(i => i.name === boatName);
  if (existingBoat) {
    return;
  }
  const planks = bot.inventory.items().find(i => i.name === 'oak_planks');
  if (!planks || planks.count < 5) {
    await craftTwelveOakPlanks(bot);
  }
  await craftItem(boatName, 1);
}