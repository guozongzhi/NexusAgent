import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/** 单条记忆项的结构 */
export interface MemoryItem {
  id: string;
  cwd: string;           // 记忆适用的工作空间前缀
  snippet: string;       // 记忆的核心内容
  createdAt: number;
}

const MEMORY_FILE_PATH = path.join(os.homedir(), '.nexus', 'memory.json');

/** 持久化读取 */
async function loadMemories(): Promise<MemoryItem[]> {
  try {
    const data = await fs.readFile(MEMORY_FILE_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return [];
    }
    // 损坏时返回空
    return [];
  }
}

/** 持久化写入 */
async function saveMemories(memories: MemoryItem[]): Promise<void> {
  await fs.mkdir(path.dirname(MEMORY_FILE_PATH), { recursive: true });
  await fs.writeFile(MEMORY_FILE_PATH, JSON.stringify(memories, null, 2), 'utf-8');
}

/** 针对当前工作目录提取相关记忆（按目录匹配，并按照时间倒序） */
export async function getRelevantMemories(cwd: string): Promise<MemoryItem[]> {
  const all = await loadMemories();
  // 仅提取匹配 cwd 前缀的（或者全局记忆：假定 cwd='/' 或 '*' 为全局，这里以通用前缀匹配处理）
  const relevant = all.filter(m => cwd.startsWith(m.cwd) || m.cwd === '*');
  // 时间倒序，最近的在前面
  return relevant.sort((a, b) => b.createdAt - a.createdAt);
}

/** 添加记忆 */
export async function addMemory(cwd: string, snippet: string, global: boolean = false): Promise<MemoryItem> {
  const all = await loadMemories();
  const memoryCwd = global ? '*' : cwd;
  const item: MemoryItem = {
    id: Math.random().toString(36).substring(2, 8),
    cwd: memoryCwd,
    snippet,
    createdAt: Date.now(),
  };
  all.push(item);
  await saveMemories(all);
  return item;
}

/** 移除记忆 */
export async function removeMemory(id: string): Promise<boolean> {
  const all = await loadMemories();
  const index = all.findIndex(m => m.id === id);
  if (index === -1) return false;
  all.splice(index, 1);
  await saveMemories(all);
  return true;
}

/** 清理匹配 cwd 的全部记忆 */
export async function clearRelevantMemories(cwd: string): Promise<number> {
  const all = await loadMemories();
  let count = 0;
  const filtered = all.filter(m => {
    if (m.cwd === cwd) {
      count++;
      return false; // 移除
    }
    return true; // 保留
  });
  if (count > 0) {
    await saveMemories(filtered);
  }
  return count;
}
