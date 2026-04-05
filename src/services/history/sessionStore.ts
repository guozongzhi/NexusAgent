import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { homedir } from 'node:os';
import type { Message } from '../../types/index.ts';

/**
 * 计算基于工作目录的哈希以作为存储文件名
 */
function getSessionFilename(cwd: string): string {
  const hash = createHash('sha256').update(cwd).digest('hex').slice(0, 16);
  return `session_${hash}.json`;
}

function getHistoryDir(): string {
  return path.join(homedir(), '.nexus', 'sessions');
}

/**
 * 加载当前目录的历史会话
 */
export async function loadSession(cwd: string): Promise<Message[]> {
  const file = path.join(getHistoryDir(), getSessionFilename(cwd));
  try {
    const raw = await readFile(file, 'utf-8');
    return JSON.parse(raw) as Message[];
  } catch {
    return [];
  }
}

/**
 * 保存当前目录的历史会话
 */
export async function saveSession(cwd: string, messages: Message[]): Promise<void> {
  // 不保存空会话
  if (messages.length === 0) return;
  
  const dir = getHistoryDir();
  const file = path.join(dir, getSessionFilename(cwd));
  
  try {
    await mkdir(dir, { recursive: true });
    // 写入历史
    await writeFile(file, JSON.stringify(messages, null, 2), { mode: 0o600 });
  } catch (err) {
    console.error('[nexus] 历史记录写入失败', err);
  }
}

/**
 * 清除当前目录的历史会话
 */
export async function clearSession(cwd: string): Promise<void> {
  const file = path.join(getHistoryDir(), getSessionFilename(cwd));
  try {
    await rm(file, { force: true });
  } catch {
    // ignore
  }
}
