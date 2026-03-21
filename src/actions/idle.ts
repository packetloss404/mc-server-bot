import { sleep } from '../util/sleep';
import { ActionResult } from './types';

export async function idle(durationMs = 5000): Promise<ActionResult> {
  await sleep(durationMs);
  return { success: true, message: `Idled for ${durationMs}ms` };
}
