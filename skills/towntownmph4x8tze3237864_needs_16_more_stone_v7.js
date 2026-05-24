async function towntownmph4x8tze3237864_needs_32_more_wood(bot) {
  // Find nearby oak log
  let oakLog = bot.findBlock({
    matching: block => block.name === 'oak_log',
    maxDistance: 32
  });

  // If not nearby, explore to find trees
  if (!oakLog) {
    await exploreUntil('north', 20, () => bot.findBlock({
      matching: block => block.name === 'oak_log',
      maxDistance: 32
    }));
    oakLog = bot.findBlock({
      matching: block => block.name === 'oak_log',
      maxDistance: 32
    });
  }

  // Mine 32 oak logs
  await mineBlock('oak_log', 32);

  // Find chest at 815, 66, 215 and deposit
  await moveTo(813, 66, 215, 2, 10);
  await depositItem('chest', 'oak_log', 32);
}