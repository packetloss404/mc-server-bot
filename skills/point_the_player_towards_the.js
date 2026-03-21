async function pointThePlayerTowardsThe(bot) {
  try {
    bot.chat("Finding forest...");
    const block = await exploreUntil({x: 1, y: 0, z: 0}, 60, () => {
      return bot.findBlock({matching: b => b.name.includes('log'), maxDistance: 32});
    });
    if (block) {
      bot.chat(`Log found near ${block.position.x}, ${block.position.y}, ${block.position.z}`);
      const dx = block.position.x - bot.entity.position.x;
      const dz = block.position.z - bot.entity.position.z;
      const angle = Math.atan2(dz, dx);
      await bot.look(angle, 0);
      bot.chat("Pointing towards the log!");
    } else {
      bot.chat("Could not find logs.");
    }
  } catch (err) {
    console.error('Error finding logs:', err);
  }
}
