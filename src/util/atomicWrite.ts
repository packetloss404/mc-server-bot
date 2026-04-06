import fs from 'fs';
import path from 'path';

/**
 * Write JSON data to a file atomically by first writing to a .tmp file
 * then renaming. This prevents partial/corrupt writes on crash.
 */
export function atomicWriteJsonSync(filePath: string, data: any): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, filePath);
}
