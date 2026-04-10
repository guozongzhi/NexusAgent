/**
 * InputHistory — 持久化输入历史
 * 支持 ↑/↓ 箭头导航回溯
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

const HISTORY_FILE = path.join(homedir(), '.nexus', 'input_history');
const MAX_HISTORY = 500;

export class InputHistory {
  private entries: string[] = [];
  private cursor = -1; // -1 表示不在历史导航中
  private pendingInput = ''; // 用户导航前正在编辑的内容

  constructor() {
    this.load();
  }

  /**
   * 从磁盘加载历史
   */
  private load(): void {
    try {
      if (existsSync(HISTORY_FILE)) {
        const data = readFileSync(HISTORY_FILE, 'utf-8');
        this.entries = data.split('\n').filter(Boolean);
      }
    } catch {
      this.entries = [];
    }
  }

  /**
   * 保存到磁盘
   */
  private save(): void {
    try {
      const dir = path.dirname(HISTORY_FILE);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(HISTORY_FILE, this.entries.join('\n'), 'utf-8');
    } catch {
      // 忽略写入失败
    }
  }

  /**
   * 添加新条目（去重 + 上限控制）
   */
  public push(input: string): void {
    const trimmed = input.trim();
    if (!trimmed) return;

    // 去除连续重复
    if (this.entries.length > 0 && this.entries[this.entries.length - 1] === trimmed) {
      return;
    }

    this.entries.push(trimmed);

    // 上限截断
    if (this.entries.length > MAX_HISTORY) {
      this.entries = this.entries.slice(-MAX_HISTORY);
    }

    this.save();
    this.resetCursor();
  }

  /**
   * 向上导航（↑）
   * @param currentInput 当前编辑框内容（首次导航时保存）
   * @returns 历史条目或 null（已到顶部）
   */
  public navigateUp(currentInput: string): string | null {
    if (this.entries.length === 0) return null;

    if (this.cursor === -1) {
      // 首次进入历史导航，保存当前编辑内容
      this.pendingInput = currentInput;
      this.cursor = this.entries.length - 1;
    } else if (this.cursor > 0) {
      this.cursor--;
    } else {
      return null; // 已到顶部
    }

    return this.entries[this.cursor]!;
  }

  /**
   * 向下导航（↓）
   * @returns 历史条目 / 原始编辑内容 / null
   */
  public navigateDown(): string | null {
    if (this.cursor === -1) return null;

    if (this.cursor < this.entries.length - 1) {
      this.cursor++;
      return this.entries[this.cursor]!;
    } else {
      // 回到原始编辑内容
      this.cursor = -1;
      return this.pendingInput;
    }
  }

  /**
   * 重置导航游标（用户提交或手动输入时调用）
   */
  public resetCursor(): void {
    this.cursor = -1;
    this.pendingInput = '';
  }

  /**
   * 获取条目总数
   */
  public get size(): number {
    return this.entries.length;
  }
}
