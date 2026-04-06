export interface NarrationContext {
  task: string;
  personality: string;
  botName: string;
  event: 'task_start' | 'task_complete' | 'task_fail' | 'discovery' | 'threat' | 'idle' | 'trade';
  details?: Record<string, unknown>;
}

type EventType = NarrationContext['event'];

const EVENT_PROBABILITIES: Record<EventType, number> = {
  task_start: 0.3,
  task_complete: 0.5,
  task_fail: 0.4,
  discovery: 0.8,
  threat: 0.7,
  idle: 0.1,
  trade: 0.6,
};

/** Personalities that talk more (+20%) or less (-20%). */
const PERSONALITY_MODIFIERS: Record<string, number> = {
  elder: 0.2,
  merchant: 0.2,
  guard: -0.2,
};

/** Rate limit window in milliseconds (30 seconds). */
const RATE_LIMIT_MS = 30_000;

// ---------------------------------------------------------------------------
// Templates: TEMPLATES[personality][event] = string[]
// Each template can contain {task}, {detail}, {name} placeholders.
// ---------------------------------------------------------------------------

const TEMPLATES: Record<string, Record<EventType, string[]>> = {
  farmer: {
    task_start: [
      'Time to get the fields going!',
      "These seeds won't plant themselves.",
      "Let's see if we can get a good crop this time.",
      "Alright, {task} it is. Sun's still up.",
    ],
    task_complete: [
      "There we go, that's done!",
      'Good honest work. {task} finished.',
      "Another job done. Nothing like it.",
      "All wrapped up. Time for a breather.",
    ],
    task_fail: [
      "Well, that didn't go as planned.",
      'Hmm, ran into trouble with {task}.',
      "Can't win 'em all. I'll try again later.",
    ],
    discovery: [
      'Well now, look what I found! {detail}',
      'Would you look at that -- {detail}!',
      "Now that's a fine find. {detail}.",
    ],
    threat: [
      'Something dangerous out there. Stay close.',
      'Trouble in the fields! {detail} spotted.',
      "Get behind me, I've got my hoe ready.",
    ],
    idle: [
      "Nice day for farming, ain't it?",
      'Wonder if the crops need water...',
      'Could use some rain about now.',
    ],
    trade: [
      "I've got plenty of wheat if you need some.",
      'Fair swap. The harvest has been kind.',
      "Let's trade -- I could use some supplies.",
    ],
  },

  guard: {
    task_start: [
      'Moving out. {task}.',
      'On it.',
      'Acknowledged. Beginning {task}.',
      "Orders received. I'll handle it.",
    ],
    task_complete: [
      'Task complete. Returning to post.',
      'Done. Area secure.',
      '{task} handled. All clear.',
      'Mission accomplished.',
    ],
    task_fail: [
      'Failed to complete {task}. Regrouping.',
      "Couldn't finish. Need better gear.",
      'Mission failed. Will reassess.',
    ],
    discovery: [
      'Found something. {detail}. Marking it.',
      'Interesting find: {detail}.',
      'Scouted {detail}. Noting position.',
    ],
    threat: [
      'Hostile spotted. Engaging.',
      'Everyone stay back, I got this.',
      '{detail} at the perimeter. Moving to intercept.',
      'Threat detected. Weapons ready.',
    ],
    idle: [
      'All quiet on the perimeter.',
      'Holding position.',
      'Nothing to report.',
    ],
    trade: [
      "Fine. What've you got?",
      'Make it quick. I need to get back.',
      "If it's useful for defense, I'm interested.",
    ],
  },

  elder: {
    task_start: [
      'Let us attend to {task}, then.',
      'A wise use of our time. I shall begin.',
      'Patience guides the hand. Starting now.',
      'Very well, {task} requires attention.',
    ],
    task_complete: [
      'It is done. As it should be.',
      'Another task settled. The village grows.',
      'Well now, {task} is behind us.',
      'Completed, as the old ways prescribe.',
    ],
    task_fail: [
      'Even wisdom cannot prevent every setback.',
      'A lesson learned from {task}.',
      'We shall try a different approach next time.',
    ],
    discovery: [
      'Well now, what have we here? {detail}!',
      'A most fortunate discovery. {detail}.',
      'The land provides. {detail}.',
    ],
    threat: [
      'Danger approaches. Everyone be cautious.',
      'I sense {detail}. We must be wary.',
      'Dark times. {detail} draws near.',
    ],
    idle: [
      'These old bones could use a rest.',
      'A quiet moment to reflect...',
      'The world turns, with or without us.',
    ],
    trade: [
      'A fair exchange benefits all.',
      'Let us barter wisely.',
      "I think we can work something out.",
    ],
  },

  explorer: {
    task_start: [
      "Let's go! Time for {task}!",
      "Adventure awaits! Starting {task}.",
      "Can't wait to get started on {task}.",
      'New challenge, new territory!',
    ],
    task_complete: [
      "New territory mapped! Found interesting things.",
      "Back from scouting. That went great!",
      '{task} done! What a ride.',
      'Another adventure in the books!',
    ],
    task_fail: [
      "That was rough. But I'll be back.",
      "Didn't quite make it. Need to regroup.",
      'Setback on {task}. Next time for sure.',
    ],
    discovery: [
      "Whoa, check this out! {detail}!",
      "You won't believe what I found -- {detail}!",
      'Incredible discovery: {detail}!',
    ],
    threat: [
      '{detail} ahead! This could be fun.',
      'Danger spotted! {detail}. Stay sharp!',
      "Something nasty up ahead. Let's deal with it.",
    ],
    idle: [
      "Itching to explore. Where to next?",
      'The horizon is calling...',
      'Wonder what lies beyond those hills.',
    ],
    trade: [
      "Got some rare finds from my travels!",
      "Picked this up exploring. Want it?",
      "Let's swap. I need supplies for the road.",
    ],
  },

  blacksmith: {
    task_start: [
      'Firing up the forge. {task} time.',
      "Right, let's get to work on {task}.",
      'Hammer and tongs ready. Starting now.',
      'Good steel takes effort. Beginning {task}.',
    ],
    task_complete: [
      'Quality work, if I say so myself.',
      '{task} finished. Solid craftsmanship.',
      "That'll hold. Job done.",
      'Another fine piece of work.',
    ],
    task_fail: [
      'Bah, the metal didn\'t cooperate.',
      'Failed at {task}. Need better materials.',
      "That didn't turn out right. Back to the anvil.",
    ],
    discovery: [
      'Now that is some fine ore. {detail}.',
      '{detail}? Could make something great with that.',
      'Look at this -- {detail}. Good stuff.',
    ],
    threat: [
      "Something's coming. Grab a weapon.",
      '{detail} nearby. I can handle this.',
      "Trouble's here. Stay behind the anvil.",
    ],
    idle: [
      'Forge is cold. Anyone need tools?',
      'Waiting on materials...',
      'Could sharpen some swords while I wait.',
    ],
    trade: [
      "Tools for materials. That's my deal.",
      'I can forge something for you. Fair price.',
      "Got iron? I've got craftsmanship.",
    ],
  },

  merchant: {
    task_start: [
      "Business calls! Let me handle {task}.",
      "Ah, {task}. There's profit in this.",
      "Time to get {task} sorted. Let's go!",
      'Off I go! {task} awaits.',
    ],
    task_complete: [
      'And that is how it is done!',
      '{task} complete. A fine outcome.',
      'Another successful venture!',
      'Splendid. {task} all wrapped up.',
    ],
    task_fail: [
      'Bad investment. {task} fell through.',
      "Not every deal works out, sadly.",
      "That didn't pan out. Onto the next one.",
    ],
    discovery: [
      'Oh my, do you see that? {detail}!',
      '{detail}! That could fetch a pretty price.',
      'What a find! {detail}. Ka-ching!',
    ],
    threat: [
      '{detail}?! Bad for business!',
      "Danger! {detail}! Protect the goods!",
      "We should move, {detail} is too close!",
    ],
    idle: [
      'Anyone looking to buy or sell?',
      'Quiet day at the market...',
      'I should organize my inventory.',
    ],
    trade: [
      'I think we can work something out.',
      'Fair trade, fair price. Always.',
      "Let me show you what I've got!",
      "Now we're talking! What do you need?",
    ],
  },

  builder: {
    task_start: [
      'Alright, {task}. I know just what to do.',
      "Time to build. Let's start {task}.",
      'Blueprint in mind. Beginning {task}.',
      'Foundation first. Starting {task}.',
    ],
    task_complete: [
      "Now that's a proper build. {task} done.",
      'Masterwork, if I do say so myself.',
      '{task} complete. Sturdy as stone.',
      'Another structure for the ages.',
    ],
    task_fail: [
      'Structural issue with {task}. Rethinking.',
      "Design didn't hold. Need to revise.",
      'Back to the drawing board on {task}.',
    ],
    discovery: [
      '{detail}! Perfect building material.',
      'Found {detail}. I can work with this.',
      'Now that is useful. {detail}.',
    ],
    threat: [
      '{detail} near the build site. Not good.',
      'Construction hazard! {detail} spotted.',
      "Keep that {detail} away from my walls.",
    ],
    idle: [
      'Could use a project right about now.',
      'Thinking about what to build next...',
      'Any construction requests?',
    ],
    trade: [
      'Got any stone? I need building stock.',
      "I'll trade labor for materials.",
      'Supplies for the build? Count me in.',
    ],
  },
};

/**
 * DecisionNarrator produces in-character chat messages for bots
 * based on personality and game events, using templates (no LLM).
 */
export class DecisionNarrator {
  /** Tracks the last narration timestamp per bot name. */
  private lastNarration: Map<string, number> = new Map();

  /**
   * Decide whether a narration should fire for the given event.
   * Enforces a 30-second per-bot rate limit, then rolls against
   * an event-type probability modified by personality chattiness.
   */
  shouldNarrate(event: NarrationContext['event'], personality: string): boolean {
    // We cannot check per-bot rate limit here (no botName param),
    // so this method only handles probability. The caller or narrate()
    // should also respect the rate limit. However, for a simpler API
    // we expose a second overload via the narrate method itself.
    const base = EVENT_PROBABILITIES[event] ?? 0.3;
    const mod = PERSONALITY_MODIFIERS[personality.toLowerCase()] ?? 0;
    const chance = Math.min(1, Math.max(0, base + mod));
    return Math.random() < chance;
  }

  /**
   * Generate a narration string for the given context.
   * Returns null if rate-limited (max 1 per 30s per bot).
   */
  narrate(context: NarrationContext): string | null {
    const now = Date.now();
    const last = this.lastNarration.get(context.botName) ?? 0;
    if (now - last < RATE_LIMIT_MS) return null;

    const personality = context.personality.toLowerCase();
    const templates = this.getTemplates(personality, context.event);
    const template = templates[Math.floor(Math.random() * templates.length)];

    const detail = context.details
      ? Object.values(context.details).join(', ')
      : '';

    const message = template
      .replace(/\{task\}/g, context.task || 'this')
      .replace(/\{detail\}/g, detail || 'something')
      .replace(/\{name\}/g, context.botName);

    this.lastNarration.set(context.botName, now);
    return message;
  }

  /**
   * Format a high-value discovery announcement.
   */
  formatDiscovery(name: string, value: number, personality: string): string {
    const p = personality.toLowerCase();
    if (value >= 80) {
      // Extremely valuable
      const exclamations: Record<string, string> = {
        farmer: `By the harvest! Found ${name}! This is incredible!`,
        guard: `High-value resource located: ${name}. Securing area.`,
        elder: `The land has blessed us. ${name} revealed at last.`,
        explorer: `Jackpot! ${name}! This is why I explore!`,
        blacksmith: `${name}! Now THAT I can work with!`,
        merchant: `${name}?! Do you know what this is worth?!`,
        builder: `${name}! Perfect for the next big project.`,
      };
      return exclamations[p] || `Found ${name}! Incredible!`;
    }

    if (value >= 50) {
      const medium: Record<string, string> = {
        farmer: `Found some ${name}. Useful stuff.`,
        guard: `${name} spotted. Noted.`,
        elder: `${name}. A welcome find.`,
        explorer: `Spotted ${name}! Not bad at all.`,
        blacksmith: `${name}. I can use that.`,
        merchant: `${name}. That'll sell well.`,
        builder: `${name}. Decent building stock.`,
      };
      return medium[p] || `Found ${name}. Could be useful.`;
    }

    // Low value
    const low: Record<string, string> = {
      farmer: `Some ${name} over here. Nothing fancy.`,
      guard: `${name}. Not a priority.`,
      elder: `${name}. Every bit counts.`,
      explorer: `Found ${name}. Noting it on the map.`,
      blacksmith: `${name}. Basic, but it'll do.`,
      merchant: `${name}. Might find a buyer.`,
      builder: `${name}. Filler material, maybe.`,
    };
    return low[p] || `Found some ${name}.`;
  }

  /**
   * Format a threat warning appropriate to danger level and personality.
   */
  formatThreatWarning(threat: string, dangerLevel: number, personality: string): string {
    const p = personality.toLowerCase();

    if (dangerLevel >= 8) {
      const critical: Record<string, string> = {
        farmer: `RUN! ${threat}! Get inside NOW!`,
        guard: `CRITICAL THREAT: ${threat}! All hands, combat ready!`,
        elder: `Great danger! ${threat} approaches. Everyone take cover!`,
        explorer: `${threat}! This is bad -- fall back!`,
        blacksmith: `${threat}! Grab your weapons, NOW!`,
        merchant: `${threat}! Forget the goods, RUN!`,
        builder: `${threat}! Get behind the walls!`,
      };
      return critical[p] || `DANGER! ${threat}! Take cover!`;
    }

    if (dangerLevel >= 5) {
      const moderate: Record<string, string> = {
        farmer: `Careful, ${threat} nearby. Stay alert.`,
        guard: `${threat} detected. Moving to engage.`,
        elder: `Be wary. ${threat} lurks close.`,
        explorer: `${threat} spotted. Could be trouble.`,
        blacksmith: `${threat} around. Keep a weapon handy.`,
        merchant: `${threat} nearby. Watch the merchandise.`,
        builder: `${threat} near the site. Eyes open.`,
      };
      return moderate[p] || `Watch out, ${threat} nearby.`;
    }

    // Low danger
    const low: Record<string, string> = {
      farmer: `Think I heard a ${threat}. Probably fine.`,
      guard: `Minor contact: ${threat}. Monitoring.`,
      elder: `A ${threat}, but no great concern yet.`,
      explorer: `${threat} in the distance. No worries.`,
      blacksmith: `${threat} somewhere. Not a big deal.`,
      merchant: `Is that a ${threat}? Eh, should be fine.`,
      builder: `${threat} around but it's far off.`,
    };
    return low[p] || `${threat} spotted, low threat.`;
  }

  /** Retrieve templates, falling back to merchant if personality unknown. */
  private getTemplates(personality: string, event: EventType): string[] {
    const personalityTemplates = TEMPLATES[personality] ?? TEMPLATES.merchant;
    return personalityTemplates[event] ?? TEMPLATES.merchant[event];
  }
}
