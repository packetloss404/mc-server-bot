export enum BotState {
  SPAWNING = 'SPAWNING',
  IDLE = 'IDLE',
  WANDERING = 'WANDERING',
  FOLLOWING = 'FOLLOWING',
  MINING = 'MINING',
  PATROLLING = 'PATROLLING',
  HOSTILE = 'HOSTILE',
  INSTINCT = 'INSTINCT',
  EXECUTING_TASK = 'EXECUTING_TASK',
  BUILDING = 'BUILDING',
  DISCONNECTED = 'DISCONNECTED',
  /** Pulled out of the server because another client logged in under this
   *  bot's username (impersonation). The bot deliberately stops reconnecting
   *  to avoid a duplicate-login tug-of-war; cleared only by an operator
   *  releasing the quarantine. See BotInstance.releaseQuarantine(). */
  QUARANTINED = 'QUARANTINED',
}

export enum BotMode {
  PRIMITIVE = 'primitive',
  CODEGEN = 'codegen',
}
