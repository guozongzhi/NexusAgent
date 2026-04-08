import { updateConfig } from '../config.ts';
import { clearSession } from '../services/history/sessionStore.ts';
import { truncateMessages, estimateTokens } from '../services/history/tokenWindow.ts';
import type { NexusConfig } from '../types/index.ts';
import type { Message } from '../types/index.ts';

export interface CommandActions {
  /** 退出应用 */
  exit: () => void;
  /** 清理屏幕与上下文状态 */
  clear: () => void;
  /** 触发重新加载配置文件 */
  reloadConfig: () => void;
  /** 获取当前消息历史（用于 /status /history /compact） */
  getHistory: () => Message[];
  /** 替换消息历史（用于 /compact） */
  setHistory: (msgs: Message[]) => void;
  /** 获取当前 token 累计 */
  getTokenCount: () => number;
  /** 获取当前模型名 */
  getModel: () => string;
}

export interface CommandResult {
  handled: boolean;
  output?: string;
}

/**
 * 拦截与解析根级别的内置命令
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
  **/help**     — 显示此帮助信息
  **/clear**    — 清除当前终端显示与持久化的会话历史
  **/config**   — 动态设置配置项 (例如: \`/config model gemma4:e4b\`)
  **/model**    — 快速切换模型 (例如: \`/model gpt-4o\`)
  **/status**   — 显示当前连接状态、模型、token 用量
  **/history**  — 查看当前会话的消息数和 token 估算
  **/compact**  — 压缩上下文窗口（截断旧消息）
  **/bug**      — 报告 Bug（生成环境诊断信息）
  **/version**  — 显示版本号
  **/exit**     — 安全退出应用
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

    case '/model': {
      if (parts.length < 2) {
        return { handled: true, output: `当前模型: ${actions.getModel()}\n用法: \`/model <name>\`` };
      }
      const modelName = parts.slice(1).join(' ');
      try {
        await updateConfig({ model: modelName });
        actions.reloadConfig();
        return { handled: true, output: `模型已切换为 \`${modelName}\`` };
      } catch (err) {
        return { handled: true, output: `模型切换失败: ${String(err)}` };
      }
    }

    case '/status': {
      const model = actions.getModel();
      const tokenCount = actions.getTokenCount();
      const history = actions.getHistory();
      const cwd = process.cwd();
      return {
        handled: true,
        output: [
          `模型: ${model}`,
          `工作目录: ${cwd}`,
          `会话消息数: ${history.length}`,
          `累计 Token: ${tokenCount}`,
        ].join('\n'),
      };
    }

    case '/history': {
      const history = actions.getHistory();
      if (history.length === 0) {
        return { handled: true, output: '当前会话无消息记录。' };
      }
      // 估算 token
      let totalTokens = 0;
      for (const msg of history) {
        if (typeof msg.content === 'string') {
          totalTokens += estimateTokens(msg.content);
        } else {
          totalTokens += estimateTokens(JSON.stringify(msg.content));
        }
      }
      const userMsgs = history.filter(m => m.role === 'user').length;
      const assistantMsgs = history.filter(m => m.role === 'assistant').length;
      return {
        handled: true,
        output: [
          `会话消息总数: ${history.length}`,
          `  用户消息: ${userMsgs}`,
          `  助手回复: ${assistantMsgs}`,
          `  估算 Token: ~${totalTokens}`,
        ].join('\n'),
      };
    }

    case '/compact': {
      const history = actions.getHistory();
      const before = history.length;
      const compacted = truncateMessages(history, 50_000); // 压缩到 50k token
      actions.setHistory(compacted);
      const after = compacted.length;
      return {
        handled: true,
        output: `上下文已压缩: ${before} → ${after} 条消息`,
      };
    }

    case '/bug': {
      const os = await import('node:os');
      const cwd = process.cwd();
      const model = actions.getModel();
      const history = actions.getHistory();
      const info = [
        `环境诊断信息`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `OS:        ${os.platform()} ${os.arch()} ${os.release()}`,
        `Shell:     ${process.env['SHELL'] ?? 'unknown'}`,
        `Bun:       ${process.versions.bun ?? 'unknown'}`,
        `工作目录:  ${cwd}`,
        `模型:      ${model}`,
        `会话消息:  ${history.length}`,
        `Token:     ${actions.getTokenCount()}`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `请将以上信息连同 Bug 描述提交到:`,
        `https://github.com/guozongzhi/NexusAgent/issues/new`,
      ];
      return { handled: true, output: info.join('\n') };
    }

    case '/version': {
      return { handled: true, output: 'Nexus Agent v0.1.0' };
    }

    default:
      return { handled: true, output: `未知命令: \`${cmd}\`。\n输入 \`/help\` 查看支持的命令。` };
  }
}
