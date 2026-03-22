async function walkToPacket1(bot) {
  const targetPlayer = bot.players['Packet1'];
  if (targetPlayer && targetPlayer.entity) {
    const pos = targetPlayer.entity.position;
    await moveTo(pos.x, pos.y, pos.z, 2, 30);
  } else {
    const target = await exploreUntil('forward', 60, () => {
      const p = bot.players['Packet1'];
      return p && p.entity ? p.entity : null;
    });
    if (target) {
      await moveTo(target.position.x, target.position.y, target.position.z, 2, 30);
    }
  }
}