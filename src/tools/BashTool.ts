/**
 * BashTool — 安全执行 Shell 命令
 * 通过 child_process 派生子进程，捕获 stdout/stderr，设置超时
 */
import { z } from 'zod';
import { exec } from 'node:child_process';
import { registerTool } from '../Tool.ts';
import type { ToolResult, ToolUseContext } from '../types/index.ts';
import { validateCommand } from '../security/pathGuard.ts';

const inputSchema = z.object({
  command: z.string().describe('要执行的 Shell 命令'),
  timeout: z.number().optional().describe('超时时间（毫秒），默认 30000'),
});

export const BashTool = registerTool({
  name: 'bash',
  description: '在当前工作目录执行 Shell 命令。用于运行脚本、安装依赖、查看进程等操作。',
  inputSchema,
  isReadOnly: false,

  async call(input, context): Promise<ToolResult> {
    // P1-5: 命令安全校验
    const check = validateCommand(input.command);
    if (!check.safe) {
      return { output: `[BLOCKED] ${check.reason}`, isError: true };
    }

    const timeout = input.timeout ?? 30_000;

    return new Promise((resolve) => {
      exec(
        input.command,
        {
          cwd: context.cwd,
          timeout,
          maxBuffer: 1024 * 1024, // 1MB 输出上限
          env: { ...process.env, LANG: 'en_US.UTF-8' },
        },
        (error, stdout, stderr) => {
          if (error) {
            // 超时或异常退出
            const errMsg = error.killed
              ? `命令执行超时 (${timeout}ms)`
              : `Exit code: ${error.code}\n${stderr || error.message}`;
            resolve({
              output: `[ERROR] ${errMsg}\n${stdout}`.trim(),
              isError: true,
            });
            return;
          }

          const output = [stdout, stderr].filter(Boolean).join('\n').trim();
          resolve({
            output: output || '(命令执行完成，无输出)',
          });
        },
      );
    });
  },
});
