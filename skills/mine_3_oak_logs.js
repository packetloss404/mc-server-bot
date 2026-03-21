async function mineThreeOakLogs(bot) {
  try {
    let log = bot.findBlock({ matching: b => b.name === 'oak_log', maxDistance: 32 });
    if (!log) {
      await exploreUntil("north", 60, () => bot.findBlock({ matching: b => b.name === 'oak_log', maxDistance: 32 }));
    }
    await mineBlock("oak_log", 3);
  } catch (err) {
    console.error("Failed to mine 3 oak logs:", err);
  }
}