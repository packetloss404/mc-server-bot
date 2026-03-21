async function mineOneOakLog(bot) {
  try {
    let oakLog = bot.findBlock({
      matching: b => b.name === 'oak_log',
      maxDistance: 32
    });

    if (!oakLog) {
      oakLog = await exploreUntil('north', 60, () => {
        return bot.findBlock({
          matching: b => b.name === 'oak_log',
          maxDistance: 32
        });
      });
    }

    if (oakLog) {
      await mineBlock('oak_log', 1);
    }
  } catch (err) {
    console.error('Error mining oak log:', err);
  }
}