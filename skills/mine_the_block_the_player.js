async function mineTheBlockThePlayer(bot) {
  try {
    const block = bot.blockAt(bot.entity.position.offset(0, bot.entity.height, 0));
    if (block && block.name !== 'air') {
      console.log(`Mining block ${block.name} at ${block.position}`);
      await moveTo(block.position.x, block.position.y, block.position.z, 2, 10);
      await bot.dig(block);
      console.log('Mined the block');
    } else {
      console.log('No block found in front of the bot');
    }
  } catch (err) {
    console.error('Error mining block:', err);
  }
}
