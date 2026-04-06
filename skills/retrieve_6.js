async function retrieve6Cobblestone(bot) {
  await moveTo(1028, 65, 409, 2, 60);
  await withdrawItem('chest', 'cobblestone', 6);
}