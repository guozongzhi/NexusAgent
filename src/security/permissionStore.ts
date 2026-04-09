import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';

/**
 * 权限控制持久化存储
 * 存储路径: ~/.nexus/permissions.json
 */

interface PermissionsData {
  /** Map<cwd, Set<toolName>> 或者简化为 Map<toolName, 'global' | 'project'> */
  // 这里为简化，先按 global_tools 记录，或者按项目记录
  alwaysAllowedGlobal: string[];
  alwaysAllowedProject: Record<string, string[]>; // { '/path/to/project': ['bash', 'file_write'] }
}

const DEFAULT_DATA: PermissionsData = {
  alwaysAllowedGlobal: [],
  alwaysAllowedProject: {},
};

function getPermissionsFilePath(): string {
  return path.join(homedir(), '.nexus', 'permissions.json');
}

/**
 * 读取本地权限配置
 */
async function loadPermissions(): Promise<PermissionsData> {
  const filePath = getPermissionsFilePath();
  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      alwaysAllowedGlobal: Array.isArray(parsed.alwaysAllowedGlobal) ? parsed.alwaysAllowedGlobal : [],
      alwaysAllowedProject: parsed.alwaysAllowedProject && typeof parsed.alwaysAllowedProject === 'object' ? parsed.alwaysAllowedProject : {},
    };
  } catch (err) {
    return DEFAULT_DATA;
  }
}

/**
 * 写入本地权限配置
 */
async function savePermissions(data: PermissionsData): Promise<void> {
  const filePath = getPermissionsFilePath();
  const dirPath = path.dirname(filePath);
  try {
    await mkdir(dirPath, { recursive: true });
    // 使用 0o600 保护权限文件
    await writeFile(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  } catch (err) {
    console.error('[Nexus] 保存权限配置失败:', err);
  }
}

/**
 * 检查指定工具在特定目录下是否已授权
 */
export async function isToolAutoApproved(toolName: string, cwd: string): Promise<boolean> {
  const data = await loadPermissions();
  if (data.alwaysAllowedGlobal.includes(toolName)) {
    return true;
  }
  const projectTools = data.alwaysAllowedProject[cwd] || [];
  if (projectTools.includes(toolName)) {
    return true;
  }
  return false;
}

/**
 * 将工具添加至自动审批列表 (支持项目级或全局级)
 */
export async function addAutoApprovedTool(toolName: string, cwd: string, scope: 'global' | 'project' = 'project'): Promise<void> {
  const data = await loadPermissions();
  
  if (scope === 'global') {
    if (!data.alwaysAllowedGlobal.includes(toolName)) {
      data.alwaysAllowedGlobal.push(toolName);
    }
  } else {
    if (!data.alwaysAllowedProject[cwd]) {
      data.alwaysAllowedProject[cwd] = [];
    }
    if (!data.alwaysAllowedProject[cwd].includes(toolName)) {
      data.alwaysAllowedProject[cwd].push(toolName);
    }
  }
  
  await savePermissions(data);
}
