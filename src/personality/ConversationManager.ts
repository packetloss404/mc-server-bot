interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export class ConversationManager {
  private maxHistory: number;
  // histories[botName][playerName] = ChatMessage[]
  private histories: Map<string, Map<string, ChatMessage[]>> = new Map();

  constructor(maxHistory = 20) {
    this.maxHistory = maxHistory;
  }

  addPlayerMessage(botName: string, playerName: string, message: string): void {
    this.getOrCreate(botName, playerName).push({ role: 'user', text: message });
    this.trim(botName, playerName);
  }

  addBotResponse(botName: string, playerName: string, response: string): void {
    this.getOrCreate(botName, playerName).push({ role: 'model', text: response });
    this.trim(botName, playerName);
  }

  getHistory(botName: string, playerName: string): ChatMessage[] {
    return this.getOrCreate(botName, playerName);
  }

  buildContentsArray(botName: string, playerName: string, newMessage: string): any[] {
    const history = this.getOrCreate(botName, playerName);
    const contents: any[] = history.map((msg) => ({
      role: msg.role,
      parts: [{ text: msg.text }],
    }));
    contents.push({ role: 'user', parts: [{ text: newMessage }] });
    return contents;
  }

  clearBot(botName: string): void {
    this.histories.delete(botName.toLowerCase());
  }

  private getOrCreate(botName: string, playerName: string): ChatMessage[] {
    const bKey = botName.toLowerCase();
    const pKey = playerName.toLowerCase();

    if (!this.histories.has(bKey)) this.histories.set(bKey, new Map());
    const botMap = this.histories.get(bKey)!;

    if (!botMap.has(pKey)) botMap.set(pKey, []);
    return botMap.get(pKey)!;
  }

  private trim(botName: string, playerName: string): void {
    const history = this.getOrCreate(botName, playerName);
    while (history.length > this.maxHistory) {
      // Remove in pairs to maintain alternating user/model roles
      history.shift();
      if (history.length > 0 && history[0].role === 'model') {
        history.shift();
      }
    }
    // Ensure history always starts with 'user' role (Gemini requirement)
    while (history.length > 0 && history[0].role === 'model') {
      history.shift();
    }
  }
}
