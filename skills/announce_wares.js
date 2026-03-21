async function announceWares(bot) {
  const messages = [
    'Fresh wares! Come take a look!',
    'Best prices in town, I guarantee it!',
    'Looking for supplies? I have what you need!',
    'Quality goods, fair prices!',
    'Step right up! Deals you won\'t find anywhere else!',
  ];
  const msg = messages[Math.floor(Math.random() * messages.length)];
  bot.chat(msg);
  console.log(`Announced: ${msg}`);
}
