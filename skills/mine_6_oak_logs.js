async function mineSixOakLogs(bot) {
  for (let i = 0; i < 6; i++) {
    let oakLog = bot.findBlock({
      matching: block => block.name === 'oak_log',
      maxDistance: 32
    });
    if (!oakLog) {
      await exploreUntil('north', 60, () => {
        return bot.findBlock({
          matching: block => block.name === 'oak_log',
          maxDistance: 32
        });
      });
    }
    await mineBlock('oak_log', 1);
  }
}