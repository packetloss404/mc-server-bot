async function mineOakLog(bot) {
  try {
    const findOakLog = () => bot.findBlock({
      matching: b => b.name === 'oak_log',
      maxDistance: 32
    });

    let oakLog = findOakLog();

    if (!oakLog) {
      await exploreUntil('north', 120, () => {
        return findOakLog();
      });
    }

    await mineBlock('oak_log', 1);
  } catch (err) {
    console.error('Error mining oak log:', err);
  }
}