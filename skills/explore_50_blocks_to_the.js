async function explore50BlocksToTheSouth(bot) {
  // The task is to explore 50 blocks to the south.
  // The exploreUntil primitive takes a direction, maxTime, and an optional callback.
  // If no specific target is being looked for, the callback can be omitted or be a no-op that always returns null.
  // However, the error "callback is not a function" indicates that exploreUntil expects a function even if it's a no-op.
  // To simply explore for a duration, we can provide a callback that always returns null, effectively just exploring until maxTime.
  // The maxTime is in seconds. To explore 50 blocks, a reasonable time might be 30-60 seconds depending on terrain.
  // Let's use 60 seconds as a rough estimate for 50 blocks.
  await exploreUntil('south', 60, () => null);
}