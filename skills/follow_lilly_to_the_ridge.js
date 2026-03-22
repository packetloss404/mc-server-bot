async function followLillyToTheRidgeTask(bot) {
  const findLilly = () => {
    return bot.players['Lilly']?.entity || Object.values(bot.players).find(p => p.username.toLowerCase().includes('lilly'))?.entity;
  };

  // Attempt to follow Lilly for a set number of iterations to reach the ridge
  for (let i = 0; i < 15; i++) {
    let lilly = findLilly();
    if (!lilly) {
      // If Lilly is not visible, explore to find her
      lilly = await exploreUntil('north', 30, () => findLilly());
    }
    if (lilly) {
      const distance = bot.entity.position.distanceTo(lilly.position);
      if (distance > 3) {
        // Move towards Lilly's current position
        // Use a reasonable timeout and range to keep up
        await moveTo(lilly.position.x, lilly.position.y, lilly.position.z, 3, 20);
      } else {
        // If close enough, wait briefly for her to move further
        await bot.waitForTicks(40);
      }
    } else {
      // If still not found after exploration, stop
      break;
    }
  }
}