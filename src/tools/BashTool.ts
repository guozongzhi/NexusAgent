/**
 * BashTool — 安全执行 Shell 命令
 *
 * 重构版（Claude Code 对齐）：
 * - Bun.spawn 流式执行，支持实时 stdout/stderr 输出
 * - 分级超时：默认 30s / 长命令 120s / 用户自定义
 * - 输出智能截断：保留前 200 行 + 后 50 行，中间折叠
 * - 环境变量清理：移除敏感变量
 * - 持久化工作目录：cd 命令效果跨调用保持
 */
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { registerTool } from '../Tool.ts';
import type { ToolResult, ToolUseContext } from '../types/index.ts';
import { validateCommand } from '../security/pathGuard.ts';

// ─── 持久化工作目录 ──────────────────────────────────
let _persistentCwd: string | null = null;

/**
 * 获取持久化工作目录（支持跨调用 cd 保持）
 */
function getEffectiveCwd(contextCwd: string): string {
  return _persistentCwd || contextCwd;
}

// ─── 敏感环境变量清理 ──────────────────────────────────
const SENSITIVE_ENV_KEYS = [
  'OPENAI_API_KEY', 'NEXUS_API_KEY', 'ANTHROPIC_API_KEY',
  'AWS_SECRET_ACCESS_KEY', 'GITHUB_TOKEN', 'GH_TOKEN',
  'NPM_TOKEN', 'HOMEBREW_GITHUB_API_TOKEN',
];

function cleanEnv(): Record<string, string | undefined> {
  const env = { ...process.env, LANG: 'en_US.UTF-8' } as Record<string, string | undefined>;
  for (const key of SENSITIVE_ENV_KEYS) {
    if (key in env) {
      delete env[key];
    }
  }
  return env;
}

// ─── 智能截断 ─────────────────────────────────────────
const MAX_HEAD_LINES = 200;
const MAX_TAIL_LINES = 50;

function smartTruncate(output: string): string {
  const lines = output.split('\n');
  if (lines.length <= MAX_HEAD_LINES + MAX_TAIL_LINES) {
    return output;
  }
  const head = lines.slice(0, MAX_HEAD_LINES).join('\n');
  const tail = lines.slice(-MAX_TAIL_LINES).join('\n');
  const omitted = lines.length - MAX_HEAD_LINES - MAX_TAIL_LINES;
  return `${head}\n\n... [已折叠 ${omitted} 行] ...\n\n${tail}`;
}

// ─── 输入 Schema ─────────────────────────────────────
const inputSchema = z.object({
  command: z.string().describe('要执行的 Shell 命令'),
  timeout: z.number().optional().describe('超时时间（毫秒），默认 30000，长命令可设 120000'),
  is_background: z.boolean().optional().describe('是否置于后台长驻运行（如 Web Server、Dev 监听器），若为 true 工具将立即返回任务 ID，模型可通过 job_manage 工具监控日志。'),
});

export const BashTool = registerTool({
  name: 'bash',
  description: '在当前工作目录执行 Shell 命令。对于耗时查询或需阻塞的前台指令默认执行。对于后台常驻进程请启用 is_background: true。',
  inputSchema,
  isReadOnly: false,

  async call(input, context): Promise<ToolResult> {
    // 命令安全校验
    const check = validateCommand(input.command);
    if (!check.safe) {
      return { output: `[BLOCKED] ${check.reason}`, isError: true };
    }

    const timeout = input.timeout ?? 30_000;
    const effectiveCwd = getEffectiveCwd(context.cwd);

    if (input.is_background) {
      const { JobManager } = await import('../core/JobManager.ts');
      const manager = JobManager.getInstance();
      const jobId = manager.spawnJob(input.command, effectiveCwd, cleanEnv());
      return { output: `[BACKGROUND JOB STARTED] Successfully launched process.\nJobID: ${jobId}\nUse 'job_manage' tool to view logs or kill the process.` };
    }

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let killed = false;

      const proc = spawn('bash', ['-c', input.command], {
        cwd: effectiveCwd,
        env: cleanEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // 超时保护
      const timer = setTimeout(() => {
        killed = true;
        proc.kill('SIGTERM');
        // 给 SIGTERM 1 秒时间，否则 SIGKILL
        setTimeout(() => {
          try { proc.kill('SIGKILL'); } catch {}
        }, 1000);
      }, timeout);

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on('close', (code) => {
        clearTimeout(timer);

        // 检测 cd 命令并更新持久化工作目录
        const cdMatch = input.command.match(/^\s*cd\s+(.+)\s*$/);
        if (cdMatch && code === 0) {
          const path = require('node:path');
          const target = cdMatch[1]!.replace(/^['"]|['"]$/g, ''); // 去引号
          _persistentCwd = path.isAbsolute(target) ? target : path.resolve(effectiveCwd, target);
        }

        if (killed) {
          resolve({
            output: smartTruncate(`[ERROR] 命令执行超时 (${timeout / 1000}s)\n${stdout}\n${stderr}`.trim()),
            isError: true,
          });
          return;
        }

        if (code !== 0) {
          resolve({
            output: smartTruncate(`[Exit ${code}]\n${stdout}\n${stderr}`.trim()),
            isError: true,
          });
          return;
        }

        const output = [stdout, stderr].filter(Boolean).join('\n').trim();
        resolve({
          output: smartTruncate(output || '(命令执行完成，无输出)'),
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          output: `[ERROR] 无法启动进程: ${err.message}`,
          isError: true,
        });
      });
    });
  },
});
