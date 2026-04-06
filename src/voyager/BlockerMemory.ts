import fs from 'fs';
import path from 'path';
import { ExecutionResult } from './CodeExecutor';
import { Task } from './CurriculumAgent';

export interface BlockerRecord {
  task: string;
  blocker: string;
  detail: string;
  count: number;
  updatedAt: number;
}

export class BlockerMemory {
  private records: BlockerRecord[] = [];
  private filePath: string;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'blockers.json');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.load();
  }

  recordTaskFailure(task: Task, executionResult: ExecutionResult, reason: string): void {
    const blocker = this.classifyBlocker(executionResult, reason);
    const detail = reason || executionResult.error || 'unknown failure';
    const existing = this.records.find((r) => r.task === task.description && r.blocker === blocker);
    if (existing) {
      existing.count += 1;
      existing.detail = detail;
      existing.updatedAt = Date.now();
    } else {
      this.records.push({ task: task.description, blocker, detail, count: 1, updatedAt: Date.now() });
    }
    this.persist();
  }

  clearTask(task: Task): void {
    this.records = this.records.filter((r) => r.task !== task.description);
    this.persist();
  }

  getTaskBlockers(task: Task): BlockerRecord[] {
    return this.records.filter((r) => r.task === task.description).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  hasStrongBlocker(task: Task): boolean {
    return this.getTaskBlockers(task).some((r) => r.count >= 2);
  }

  summarize(task?: Task): string {
    const records = task ? this.getTaskBlockers(task) : this.records.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 10);
    if (records.length === 0) return 'none';
    return records.map((r) => `${r.task} -> ${r.blocker} (${r.count}): ${r.detail}`).join(' | ');
  }

  private classifyBlocker(executionResult: ExecutionResult, reason: string): string {
    const text = `${reason} ${executionResult.error || ''} ${executionResult.output}`.toLowerCase();
    if (text.includes('parse error') || text.includes('unexpected token') || text.includes('missing )') || text.includes('unexpected identifier')) {
      return 'syntax';
    }
    if (text.includes('timed out') || text.includes('did not move significantly') || text.includes('path')) {
      return 'movement';
    }
    if (text.includes('no recipe found') || text.includes('required materials') || text.includes('craft')) {
      return 'materials';
    }
    if (text.includes('unknown block') || text.includes('nothing was mined') || text.includes('did not collect')) {
      return 'targeting';
    }
    if (text.includes('interrupted')) {
      return 'interrupt';
    }
    return 'general';
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      this.records = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
    } catch {
      this.records = [];
    }
  }

  private persist(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.records, null, 2));
  }
}
