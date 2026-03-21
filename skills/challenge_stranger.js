async function challengeStranger(bot) {
  const players = Object.values(bot.players).filter(p => p.entity);
  if (players.length === 0) {
    console.log('No one around to challenge');
    return;
  }
  const phrases = [
    'Halt! State your business.',
    'Who goes there? Identify yourself!',
    'You there! What brings you to these parts?',
    'Keep your hands where I can see them.',
  ];
  const phrase = phrases[Math.floor(Math.random() * phrases.length)];
  bot.chat(phrase);
  console.log(`Challenged: ${phrase}`);
}
