async function shareWisdom(bot) {
  const wisdom = [
    'The diamond hides deepest where the lava flows.',
    'A creeper feared is a creeper survived.',
    'Build your walls high, but your friendships higher.',
    'The wise miner always carries a water bucket.',
    'Even the Ender Dragon was once an egg.',
    'Patience and stone make a fortress.',
  ];
  const saying = wisdom[Math.floor(Math.random() * wisdom.length)];
  bot.chat(saying);
  console.log(`Shared wisdom: ${saying}`);
}
