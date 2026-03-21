import { Bot } from 'mineflayer';
import { ActionResult } from './types';

export async function say(bot: Bot, message: string): Promise<ActionResult> {
  bot.chat(message);
  return { success: true, message: `Said: ${message}` };
}
