import { updateConfig, loadConfig } from '../config.ts';
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
  rewrittenQuery?: string;
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
  **/mcp**      — 管理 MCP 动态插件扩展 (list/add/remove)
  **/memory**   — 管理跨会话的长效记忆 (list/add/rm/clear)
  **/skills**   — 管理与执行工作流技能 (/sk, list, add, rm)
  **/init**     — 初始化项目 NEXUS.md 文件
  **/diff**     — 查看当前 Git 未提交的更改
  **/commit**   — 查看 Git 状态并提示提交
  **/cost**     — 查看本次会话的 Token 耗费
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

    case '/mcp': {
      if (parts.length < 2) {
        return { handled: true, output: '用法:\n  `/mcp list`\n  `/mcp add <name> <command...>`\n  `/mcp rm <name>`' };
      }
      const subCmd = parts[1];
      const config = await loadConfig();
      const servers = config.mcpServers || {};
      
      if (subCmd === 'list') {
        const count = Object.keys(servers).length;
        if (count === 0) return { handled: true, output: '未配置任何外部 MCP 服务器。' };
        const list = Object.entries(servers).map(([name, conf]) => `- **${name}**: \`${conf.command} ${conf.args.join(' ')}\``).join('\n');
        return { handled: true, output: `已配置的 MCP 服务器:\n${list}\n\n*Agent 会在下次提问时自动挂载它们的工具。*` };
      }
      
      if (subCmd === 'add') {
        if (parts.length < 4) return { handled: true, output: '用法: `/mcp add <name> <command> [args...]`' };
        const name = parts[2]!;
        const cmd = parts[3]!;
        const args = parts.slice(4);
        servers[name] = { command: cmd, args };
        await updateConfig({ mcpServers: servers });
        actions.reloadConfig();
        return { handled: true, output: `✅ MCP 服务器 \`${name}\` 已成功录入。\n配置值: \`${cmd} ${args.join(' ')}\`` };
      }

      if (subCmd === 'remove' || subCmd === 'rm') {
        const name = parts[2];
        if (!name) return { handled: true, output: '用法: `/mcp rm <name>`' };
        if (servers[name]) {
          delete servers[name];
          await updateConfig({ mcpServers: servers });
          actions.reloadConfig();
          return { handled: true, output: `🗑️ MCP 服务器 \`${name}\` 已移除。` };
        }
        return { handled: true, output: `找不到名为 \`${name}\` 的 MCP 服务器。` };
      }
      return { handled: true, output: '未知的 /mcp 子命令。' };
    }

    case '/memory': {
      if (parts.length < 2) {
        return { handled: true, output: '用法:\n  `/memory list`\n  `/memory add <内容>`\n  `/memory global <内容>` (全局记忆)\n  `/memory rm <id>`\n  `/memory clear`\n\n*长效记忆会在每次对话时自动注入给 Agent。*' };
      }
      
      const subCmd = parts[1];
      const cwd = process.cwd();
      const { getRelevantMemories, addMemory, removeMemory, clearRelevantMemories } = await import('../services/memory/memoryStore.ts');

      if (subCmd === 'list') {
        const memories = await getRelevantMemories(cwd);
        if (memories.length === 0) {
          return { handled: true, output: '当前目录下无任何长效记忆。使用 `/memory add <内容>` 录入。' };
        }
        const list = memories.map(m => `- \`[${m.id}]\` ${m.cwd === '*' ? '(全局) ' : ''}${m.snippet}`).join('\n');
        return { handled: true, output: `当前目录的相关长效记忆:\n\n${list}` };
      }

      if (subCmd === 'add' || subCmd === 'global') {
        const snippet = parts.slice(2).join(' ');
        if (!snippet) {
          return { handled: true, output: `用法: \`/memory ${subCmd} <具体内容>\`` };
        }
        const isGlobal = subCmd === 'global';
        const item = await addMemory(cwd, snippet, isGlobal);
        return { handled: true, output: `✅ 记忆录入成功 (ID: \`${item.id}\`)。\n作用域: ${item.cwd}` };
      }

      if (subCmd === 'rm') {
        const id = parts[2];
        if (!id) return { handled: true, output: '用法: `/memory rm <id>`' };
        const ok = await removeMemory(id);
        if (ok) {
          return { handled: true, output: `🗑️ 记忆 \`${id}\` 已移除。` };
        }
        return { handled: true, output: `找不到 ID 为 \`${id}\` 的记忆。` };
      }

      if (subCmd === 'clear') {
        const count = await clearRelevantMemories(cwd);
        return { handled: true, output: `✅ 已清零当前目录下的专属记忆 (共 ${count} 条，全局记忆不受影响)。` };
      }

      return { handled: true, output: '未知的 /memory 子命令。' };
    }

    case '/sk':
    case '/skills': {
      const subCmd = parts[1];
      const { getAllSkills, createSkill, removeSkill } = await import('../services/skills/skillManager.ts');
      
      if (!subCmd) {
        return { handled: true, output: '用法:\n  `/skills list`\n  `/skills add <name> <描述>`\n  `/skills rm <name>`\n  `/sk <name>` (直接执行技能)' };
      }

      const allSkills = await getAllSkills();

      if (subCmd === 'list') {
        if (allSkills.length === 0) return { handled: true, output: '尚未配置任何技能。' };
        const list = allSkills.map(s => `- **${s.name}**: ${s.description}`).join('\n');
        return { handled: true, output: `已配置的技能:\n\n${list}\n\n使用 \`/sk <name>\` 来执行。` };
      }

      if (subCmd === 'add') {
        if (parts.length < 4) return { handled: true, output: '用法: `/skills add <name> <描述>`\n(执行后会在 ~/.nexus/skills/<name>.json 中生成配置，请自行去编辑 \`prompt\`)' };
        const name = parts[2]!;
        const desc = parts.slice(3).join(' ');
        const testPrompt = `请解释当前工作目录的作用。`;
        const p = await createSkill(name, desc, testPrompt);
        return { handled: true, output: `✅ 技能 \`${name}\` 创建成功！\n请打开 \`${p}\` 编辑具体的 Prompt 工作流。` };
      }

      if (subCmd === 'rm') {
        const name = parts[2];
        if (!name) return { handled: true, output: '用法: `/skills rm <name>`' };
        const ok = await removeSkill(name);
        if (ok) return { handled: true, output: `🗑️ 技能 \`${name}\` 已移除。` };
        return { handled: true, output: `找不到名为 \`${name}\` 的技能。` };
      }

      // 如果是 /sk <name> 则找是不是技能名
      const skill = allSkills.find(s => s.name === subCmd);
      if (skill) {
        return { handled: true, rewrittenQuery: skill.prompt };
      }

      return { handled: true, output: `无法识别的技能或命令: \`${subCmd}\`。\n输入 \`/skills list\` 查看可用技能。` };
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
      return { handled: true, output: 'Nexus Agent v0.2.0' };
    }

    case '/init': {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const cwd = process.cwd();
      const nexusPath = path.join(cwd, 'NEXUS.md');
      try {
        await fs.access(nexusPath);
        return { handled: true, output: `NEXUS.md 已存在于 ${nexusPath}，跳过初始化。` };
      } catch {
        const template = `# 项目规范\n\n## 代码风格\n- 使用 TypeScript 严格模式\n- 变量命名使用 camelCase\n\n## 提交规范\n- 使用 Conventional Commits\n\n## 测试要求\n- 每个新功能必须包含测试\n`;
        await fs.writeFile(nexusPath, template, 'utf-8');
        return { handled: true, output: `✅ NEXUS.md 已初始化于 ${nexusPath}\n你可以编辑它来定义项目级别的 AI 行为规范。` };
      }
    }

    case '/diff': {
      const { execSync } = await import('node:child_process');
      const cwd = process.cwd();
      try {
        const isGit = execSync('git rev-parse --is-inside-work-tree', { cwd, encoding: 'utf-8' }).trim();
        if (isGit !== 'true') {
          return { handled: true, output: '当前目录不是 Git 仓库。' };
        }
        const staged = execSync('git diff --cached --stat', { cwd, encoding: 'utf-8' }).trim();
        const unstaged = execSync('git diff --stat', { cwd, encoding: 'utf-8' }).trim();
        const untracked = execSync('git ls-files --others --exclude-standard', { cwd, encoding: 'utf-8' }).trim();
        
        const sections: string[] = [];
        if (staged) sections.push(`### 已暂存 (Staged)\n\`\`\`\n${staged}\n\`\`\``);
        if (unstaged) sections.push(`### 未暂存 (Modified)\n\`\`\`\n${unstaged}\n\`\`\``);
        if (untracked) sections.push(`### 未跟踪 (Untracked)\n${untracked.split('\n').map(f => `- ${f}`).join('\n')}`);
        
        if (sections.length === 0) {
          return { handled: true, output: '工作目录干净，无待提交的变更。' };
        }
        return { handled: true, output: sections.join('\n\n') };
      } catch (err) {
        return { handled: true, output: `Git 操作失败: ${String(err)}` };
      }
    }

    case '/commit': {
      const { execSync } = await import('node:child_process');
      const cwd = process.cwd();
      try {
        const isGit = execSync('git rev-parse --is-inside-work-tree', { cwd, encoding: 'utf-8' }).trim();
        if (isGit !== 'true') {
          return { handled: true, output: '当前目录不是 Git 仓库。' };
        }
        const status = execSync('git status --short', { cwd, encoding: 'utf-8' }).trim();
        if (!status) {
          return { handled: true, output: '工作目录干净，无需提交。' };
        }
        return {
          handled: true,
          output: `Git 状态:\n\`\`\`\n${status}\n\`\`\`\n\n要提交变更，请在对话中告诉我提交信息，我会使用 bash 工具执行 \`git add\` 和 \`git commit\`。`,
        };
      } catch (err) {
        return { handled: true, output: `Git 操作失败: ${String(err)}` };
      }
    }

    case '/cost': {
      const tokenCount = actions.getTokenCount();
      const model = actions.getModel();
      // 粗略估算（基于 GPT-4o 均价 $5/1M token）
      const estimatedCost = (tokenCount / 1_000_000 * 5).toFixed(4);
      return {
        handled: true,
        output: [
          `本次会话 Token 统计`,
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          `模型:       ${model}`,
          `累计 Token: ${tokenCount.toLocaleString()}`,
          `估算费用: ~$${estimatedCost} (基于 GPT-4o 均价)`,
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        ].join('\n'),
      };
    }

    default:
      return { handled: true, output: `未知命令: \`${cmd}\`。\n输入 \`/help\` 查看支持的命令。` };
  }
}
