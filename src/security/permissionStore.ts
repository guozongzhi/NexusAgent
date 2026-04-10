/**
 * 权限控制持久化存储
 *
 * 增强版（Claude Code 对齐）：
 * - 支持 .nexus/settings.json 项目级配置（可版本控制）
 * - 权限过期机制（默认 7 天过期需重新确认）
 * - 权限记录审计日志
 */
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

// ─── 类型 ────────────────────────────────────────────────

interface PermissionEntry {
  toolName: string;
  grantedAt: number; // timestamp
  expiresAt?: number; // timestamp, undefined = 永不过期
}

interface PermissionsData {
  /** 全局 Always Allow */
  alwaysAllowedGlobal: PermissionEntry[];
  /** 项目级 Always Allow: { '/path/to/project': [...] } */
  alwaysAllowedProject: Record<string, PermissionEntry[]>;
}

/** 项目级配置 (.nexus/settings.json，可版本控制) */
interface ProjectSettings {
  /** 预授权工具列表 */
  allowedTools?: string[];
  /** 是否禁用所有权限确认 */
  skipPermissions?: boolean;
}

// ─── 默认值与常量 ────────────────────────────────────────

const DEFAULT_DATA: PermissionsData = {
  alwaysAllowedGlobal: [],
  alwaysAllowedProject: {},
};

/** 权限过期时间：7 天 */
const PERMISSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function getPermissionsFilePath(): string {
  return path.join(homedir(), '.nexus', 'permissions.json');
}

function getAuditLogPath(): string {
  return path.join(homedir(), '.nexus', 'audit.log');
}

// ─── 读写 ────────────────────────────────────────────────

async function loadPermissions(): Promise<PermissionsData> {
  const filePath = getPermissionsFilePath();
  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);

    // 兼容旧格式（string[] → PermissionEntry[]）
    const migrateEntries = (arr: any[]): PermissionEntry[] => {
      return arr.map(item => {
        if (typeof item === 'string') {
          return { toolName: item, grantedAt: Date.now() };
        }
        return item as PermissionEntry;
      });
    };

    return {
      alwaysAllowedGlobal: Array.isArray(parsed.alwaysAllowedGlobal)
        ? migrateEntries(parsed.alwaysAllowedGlobal)
        : [],
      alwaysAllowedProject: parsed.alwaysAllowedProject && typeof parsed.alwaysAllowedProject === 'object'
        ? Object.fromEntries(
            Object.entries(parsed.alwaysAllowedProject).map(([k, v]) => [
              k,
              Array.isArray(v) ? migrateEntries(v as any[]) : [],
            ])
          )
        : {},
    };
  } catch {
    return DEFAULT_DATA;
  }
}

async function savePermissions(data: PermissionsData): Promise<void> {
  const filePath = getPermissionsFilePath();
  const dirPath = path.dirname(filePath);
  try {
    await mkdir(dirPath, { recursive: true });
    await writeFile(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  } catch (err) {
    console.error('[Nexus] 保存权限配置失败:', err);
  }
}

// ─── 项目级配置 (.nexus/settings.json) ──────────────────

async function loadProjectSettings(cwd: string): Promise<ProjectSettings | null> {
  const settingsPath = path.join(cwd, '.nexus', 'settings.json');
  try {
    if (!existsSync(settingsPath)) return null;
    const raw = await readFile(settingsPath, 'utf-8');
    return JSON.parse(raw) as ProjectSettings;
  } catch {
    return null;
  }
}

// ─── 审计日志 ────────────────────────────────────────────

async function auditLog(action: string, toolName: string, cwd: string): Promise<void> {
  try {
    const logPath = getAuditLogPath();
    const dirPath = path.dirname(logPath);
    await mkdir(dirPath, { recursive: true });
    const entry = `[${new Date().toISOString()}] ${action} tool=${toolName} cwd=${cwd}\n`;
    await appendFile(logPath, entry, { mode: 0o600 });
  } catch {
    // 审计日志写入失败不影响主流程
  }
}

// ─── 过期检查 ────────────────────────────────────────────

function isExpired(entry: PermissionEntry): boolean {
  if (!entry.expiresAt) return false; // 无过期时间 = 永不过期
  return Date.now() > entry.expiresAt;
}

/**
 * 清理已过期的权限条目
 */
async function cleanExpired(data: PermissionsData): Promise<boolean> {
  let cleaned = false;
  const now = Date.now();

  data.alwaysAllowedGlobal = data.alwaysAllowedGlobal.filter(e => {
    if (isExpired(e)) { cleaned = true; return false; }
    return true;
  });

  for (const [key, entries] of Object.entries(data.alwaysAllowedProject)) {
    data.alwaysAllowedProject[key] = entries.filter(e => {
      if (isExpired(e)) { cleaned = true; return false; }
      return true;
    });
  }

  return cleaned;
}

// ─── 公共 API ────────────────────────────────────────────

/**
 * 检查指定工具在特定目录下是否已授权
 */
export async function isToolAutoApproved(toolName: string, cwd: string): Promise<boolean> {
  // 1. 检查项目级 .nexus/settings.json
  const settings = await loadProjectSettings(cwd);
  if (settings?.skipPermissions) return true;
  if (settings?.allowedTools?.includes(toolName)) return true;

  // 2. 检查持久化权限
  const data = await loadPermissions();

  // 清理过期
  const hadExpired = await cleanExpired(data);
  if (hadExpired) await savePermissions(data);

  // 全局
  if (data.alwaysAllowedGlobal.some(e => e.toolName === toolName && !isExpired(e))) {
    return true;
  }

  // 项目级
  const projectEntries = data.alwaysAllowedProject[cwd] || [];
  if (projectEntries.some(e => e.toolName === toolName && !isExpired(e))) {
    return true;
  }

  return false;
}

/**
 * 将工具添加至自动审批列表 (支持项目级或全局级)
 */
export async function addAutoApprovedTool(
  toolName: string,
  cwd: string,
  scope: 'global' | 'project' = 'project',
): Promise<void> {
  const data = await loadPermissions();
  const entry: PermissionEntry = {
    toolName,
    grantedAt: Date.now(),
    expiresAt: Date.now() + PERMISSION_TTL_MS,
  };

  if (scope === 'global') {
    // 移除已有的同名条目（更新）
    data.alwaysAllowedGlobal = data.alwaysAllowedGlobal.filter(e => e.toolName !== toolName);
    data.alwaysAllowedGlobal.push(entry);
  } else {
    if (!data.alwaysAllowedProject[cwd]) {
      data.alwaysAllowedProject[cwd] = [];
    }
    data.alwaysAllowedProject[cwd] = data.alwaysAllowedProject[cwd].filter(e => e.toolName !== toolName);
    data.alwaysAllowedProject[cwd].push(entry);
  }

  await savePermissions(data);
  await auditLog('GRANT', toolName, cwd);
}
