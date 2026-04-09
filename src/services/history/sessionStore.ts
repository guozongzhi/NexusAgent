import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { homedir } from 'node:os';
import type { Message } from '../../types/index.ts';

/** 会话元数据 */
export interface SessionMeta {
  sessionId: string;
  cwd: string;
  createdAt: number;
  lastActive: number;
  messageCount: number;
}

function getHistoryDir(): string {
  return path.join(homedir(), '.nexus', 'sessions');
}

function getSessionFilePath(sessionId: string): string {
  return path.join(getHistoryDir(), `${sessionId}.json`);
}

function getIndexFilePath(): string {
  return path.join(getHistoryDir(), 'index.json');
}

// ─── 当前活跃会话 ID（进程级单例） ─────────────────────
let _currentSessionId: string | null = null;

/**
 * 获取当前会话 ID（惰性初始化）
 */
export function getCurrentSessionId(): string {
  if (!_currentSessionId) {
    _currentSessionId = randomUUID();
  }
  return _currentSessionId;
}

/**
 * 设置当前会话 ID（用于恢复场景）
 */
export function setCurrentSessionId(id: string): void {
  _currentSessionId = id;
}

// ─── 索引操作 ─────────────────────────────────────────
async function loadIndex(): Promise<SessionMeta[]> {
  try {
    const raw = await readFile(getIndexFilePath(), 'utf-8');
    return JSON.parse(raw) as SessionMeta[];
  } catch {
    return [];
  }
}

async function saveIndex(index: SessionMeta[]): Promise<void> {
  const dir = getHistoryDir();
  await mkdir(dir, { recursive: true });
  await writeFile(getIndexFilePath(), JSON.stringify(index, null, 2), { mode: 0o600 });
}

async function upsertIndex(meta: SessionMeta): Promise<void> {
  const index = await loadIndex();
  const existing = index.findIndex(m => m.sessionId === meta.sessionId);
  if (existing >= 0) {
    index[existing] = meta;
  } else {
    index.push(meta);
  }
  // 仅保留最近 100 条会话索引
  if (index.length > 100) {
    index.sort((a, b) => b.lastActive - a.lastActive);
    index.splice(100);
  }
  await saveIndex(index);
}

// ─── 公开 API ──────────────────────────────────────────

/**
 * 加载当前会话的历史（兼容旧格式迁移）
 */
export async function loadSession(cwd: string): Promise<Message[]> {
  const sessionId = getCurrentSessionId();
  const file = getSessionFilePath(sessionId);
  try {
    const raw = await readFile(file, 'utf-8');
    return JSON.parse(raw) as Message[];
  } catch {
    // 尝试兼容旧格式（基于 cwd hash 的单文件）
    const legacyHash = createHash('sha256').update(cwd).digest('hex').slice(0, 16);
    const legacyFile = path.join(getHistoryDir(), `session_${legacyHash}.json`);
    try {
      const raw = await readFile(legacyFile, 'utf-8');
      return JSON.parse(raw) as Message[];
    } catch {
      return [];
    }
  }
}

/**
 * 保存当前会话
 */
export async function saveSession(cwd: string, messages: Message[]): Promise<void> {
  if (messages.length === 0) return;

  const sessionId = getCurrentSessionId();
  const dir = getHistoryDir();
  const file = getSessionFilePath(sessionId);

  try {
    await mkdir(dir, { recursive: true });
    await writeFile(file, JSON.stringify(messages, null, 2), { mode: 0o600 });

    // 更新索引
    await upsertIndex({
      sessionId,
      cwd,
      createdAt: Date.now(), // 首次写入时设置（upsert 会保留已有的）
      lastActive: Date.now(),
      messageCount: messages.length,
    });
  } catch (err) {
    console.error('[nexus] 历史记录写入失败', err);
  }
}

/**
 * 清除当前会话
 */
export async function clearSession(cwd: string): Promise<void> {
  const sessionId = getCurrentSessionId();
  const file = getSessionFilePath(sessionId);
  try {
    await rm(file, { force: true });
  } catch {
    // ignore
  }
  // 重新生成会话 ID
  _currentSessionId = randomUUID();
}

/**
 * 获取指定目录的最近会话列表（供 /resume 使用）
 */
export async function listSessions(cwd?: string): Promise<SessionMeta[]> {
  const index = await loadIndex();
  const filtered = cwd ? index.filter(m => m.cwd === cwd) : index;
  return filtered.sort((a, b) => b.lastActive - a.lastActive);
}

/**
 * 恢复指定会话
 */
export async function resumeSession(sessionId: string): Promise<Message[]> {
  setCurrentSessionId(sessionId);
  const file = getSessionFilePath(sessionId);
  try {
    const raw = await readFile(file, 'utf-8');
    return JSON.parse(raw) as Message[];
  } catch {
    return [];
  }
}
