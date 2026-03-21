async function idleAndLookAround(bot) {
  console.log('Looking around idly');
  for (let i = 0; i < 4; i++) {
    const yaw = Math.random() * Math.PI * 2;
    const pitch = (Math.random() - 0.5) * 0.5;
    await bot.look(yaw, pitch);
    await bot.waitForTicks(40 + Math.floor(Math.random() * 40));
  }
  console.log('Done looking around');
}
