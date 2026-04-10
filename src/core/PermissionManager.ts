/**
 * PermissionManager — 权限判定与管理
 * 合并 permissionStore + useAgentLoop 中散落的权限逻辑为独立模块
 */
import { isToolAutoApproved, addAutoApprovedTool } from '../security/permissionStore.ts';

// ─── 只读工具列表（自动跳过权限确认）──────────────────
export const READ_ONLY_TOOLS = ['file_read', 'list_dir', 'search', 'grep', 'glob', 'note'];

// ─── 权限类型 ────────────────────────────────────────

export type AuthDecision = 'allow' | 'deny' | 'prompt';

export interface PermissionCheckResult {
  decision: AuthDecision;
  reason?: string;
}

export interface PermissionManagerOptions {
  /** 是否跳过所有权限确认（CI/自动化模式） */
  skipPermissions: boolean;
  /** 当前工作目录 */
  cwd: string;
}

// ─── 内存缓存 ────────────────────────────────────────
const _approvalCache = new Map<string, boolean>();

/**
 * 权限管理器
 * 集中处理所有工具的权限判定逻辑
 */
export class PermissionManager {
  private readonly skipPermissions: boolean;
  private readonly cwd: string;

  constructor(options: PermissionManagerOptions) {
    this.skipPermissions = options.skipPermissions;
    this.cwd = options.cwd;
  }

  /**
   * 检查工具是否需要权限确认
   */
  public async checkPermission(
    toolName: string,
    authType?: 'safe' | 'requires_confirm' | 'dangerous',
    isReadOnly?: boolean,
  ): Promise<PermissionCheckResult> {
    // 1. CI 模式直接放行
    if (this.skipPermissions) {
      return { decision: 'allow', reason: 'skip-permissions mode' };
    }

    // 2. 只读工具 / safe 类型直接放行
    const isSafe = READ_ONLY_TOOLS.includes(toolName) || authType === 'safe' || isReadOnly;
    if (isSafe && !toolName.startsWith('mcp__')) {
      return { decision: 'allow', reason: 'read-only or safe tool' };
    }

    // 3. MCP 工具始终需要确认
    if (toolName.startsWith('mcp__')) {
      // 但也检查是否已 Always Allow
      const cached = await this.isAutoApproved(toolName);
      if (cached) return { decision: 'allow', reason: 'always-allowed (cached)' };
      return { decision: 'prompt', reason: 'external MCP tool' };
    }

    // 4. dangerous 类型强制确认，无视 Always Allow
    if (authType === 'dangerous') {
      return { decision: 'prompt', reason: 'dangerous operation' };
    }

    // 5. requires_confirm: 检查是否已 Always Allow
    const approved = await this.isAutoApproved(toolName);
    if (approved) {
      return { decision: 'allow', reason: 'always-allowed' };
    }

    return { decision: 'prompt' };
  }

  /**
   * 检查工具是否已被自动批准（带内存缓存）
   */
  private async isAutoApproved(toolName: string): Promise<boolean> {
    const cacheKey = `${this.cwd}:${toolName}`;
    if (_approvalCache.has(cacheKey)) {
      return _approvalCache.get(cacheKey)!;
    }
    const result = await isToolAutoApproved(toolName, this.cwd);
    _approvalCache.set(cacheKey, result);
    return result;
  }

  /**
   * 将工具添加到 Always Allow 列表
   */
  public async addAlwaysAllow(toolName: string, scope: 'global' | 'project' = 'project'): Promise<void> {
    await addAutoApprovedTool(toolName, this.cwd, scope);
    // 更新缓存
    const cacheKey = `${this.cwd}:${toolName}`;
    _approvalCache.set(cacheKey, true);
  }

  /**
   * 清除缓存
   */
  public clearCache(): void {
    _approvalCache.clear();
  }
}
