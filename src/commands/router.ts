import { updateConfig } from '../config.ts';
import { clearSession } from '../services/history/sessionStore.ts';
import type { NexusConfig } from '../types/index.ts';

export interface CommandActions {
  /** 退出应用 */
  exit: () => void;
  /** 清理屏幕与上下文状态 */
  clear: () => void;
  /** 触发重新加载配置文件 */
  reloadConfig: () => void;
}

export interface CommandResult {
  handled: boolean;
  output?: string;
}

/**
 * 拦截与解析根级别的内置命令
 * 例如: /help, /config, /clear
 */
export async function parseAndRouteCommand(query: string, actions: CommandActions): Promise<CommandResult> {
  const text = query.trim();
  if (!text.startsWith('/')) {
    return { handled: false };
  }

  const parts = text.split(/\s+/);
  const cmd = parts[0]?.toLowerCase();

  switch (cmd) {
    case '/exit':
    case '/quit':
      actions.exit();
      return { handled: true };

    case '/clear':
      await clearSession(process.cwd());
      actions.clear();
      return { handled: true, output: '会话记录已清理。' };

    case '/help':
      return {
        handled: true,
        output: `
# Nexus Agent 命令指南
  **/help**    — 显示此帮助信息
  **/clear**   — 清除当前终端显示与持久化的会话历史
  **/config**  — 动态设置配置项 (例如: \`/config model gemma4:e4b\`)
  **/exit**    — 安全退出应用
`
      };

    case '/config': {
      if (parts.length < 3) {
        return { handled: true, output: '用法: `/config <key> <value>`' };
      }
      
      const key = parts[1] as keyof NexusConfig;
      const val = parts.slice(2).join(' ');
      
      try {
        await updateConfig({ [key]: val });
        actions.reloadConfig();
        return { handled: true, output: `配置 \`${key}\` 已更新为 \`${val}\`。` };
      } catch (err) {
        return { handled: true, output: `配置更新失败: ${String(err)}` };
      }
    }

    default:
      return { handled: true, output: `未知命令: \`${cmd}\`。\n输入 \`/help\` 查看支持的命令。` };
  }
}
