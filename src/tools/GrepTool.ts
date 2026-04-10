/**
 * GrepTool — 代码搜索工具
 *
 * 重构版（Claude Code 对齐）：
 * - 优先使用 ripgrep (rg)，不存在时降级到 grep
 * - 自动尊重 .gitignore 规则
 * - 上下文行：默认显示匹配行前后各 2 行
 */
import { spawn, execSync } from 'node:child_process';
import { z } from 'zod';
import { registerTool } from '../Tool.ts';
import type { ToolResult } from '../types/index.ts';

// ─── ripgrep 可用性检测（缓存） ─────────────────────
let _hasRipgrep: boolean | null = null;

function hasRipgrep(): boolean {
  if (_hasRipgrep !== null) return _hasRipgrep;
  try {
    execSync('rg --version', { stdio: 'ignore' });
    _hasRipgrep = true;
  } catch {
    _hasRipgrep = false;
  }
  return _hasRipgrep;
}

export const GrepTool = registerTool({
  name: 'grep',
  description: '在工作区全域搜索文本（优先使用 ripgrep，速度更快并自动尊重 .gitignore）。返回匹配行号和前后上下文。',
  inputSchema: z.object({
    query: z.string().describe('搜索的文本或正则表达式'),
    include: z.string().optional().describe('限制搜索的文件路径模式（如 *.ts 或 src/*）'),
    contextLines: z.number().optional().describe('匹配行前后的上下文行数（默认 2）'),
  }),
  isReadOnly: true,

  async call(input, context): Promise<ToolResult> {
    const { query, include, contextLines = 2 } = input;

    return new Promise((resolve) => {
      let args: string[];
      let command: string;

      if (hasRipgrep()) {
        // ripgrep: 自动尊重 .gitignore，更快
        command = 'rg';
        args = [
          '-n',                    // 行号
          '--color=never',         // 无颜色
          '-C', String(contextLines), // 上下文行
          '--max-count=200',       // 最多 200 个匹配
          '--type-add', 'web:*.{ts,tsx,js,jsx,json,css,html,md,py,go,rs,java,c,cpp,h,yml,yaml,toml}',
        ];
        if (include) {
          args.push('-g', include);
        }
        args.push(query, '.');
      } else {
        // grep 降级
        command = 'grep';
        args = [
          '-rnE',                  // 递归, 行号, 扩展正则
          '-C', String(contextLines),
          '--exclude-dir=node_modules',
          '--exclude-dir=.git',
          '--exclude-dir=.next',
          '--exclude-dir=dist',
          '--exclude-dir=__pycache__',
          '--exclude-dir=.venv',
        ];
        if (include) {
          args.push(`--include=${include}`);
        }
        args.push(query, '.');
      }

      const proc = spawn(command, args, { cwd: context.cwd });

      let out = '';
      let err = '';

      proc.stdout.on('data', (d) => (out += d.toString()));
      proc.stderr.on('data', (d) => (err += d.toString()));

      proc.on('close', (code) => {
        // grep/rg 找不到匹配项时返回 code 1
        if (code === 1 && out.trim() === '') {
          return resolve({
            output: `未能找到包含 "${query}" 的内容。`,
            isError: false,
          });
        }

        if (code !== 0 && code !== 1) {
          return resolve({
            output: `[ERROR] 搜索执行失败 (code ${code}): ${err}`,
            isError: true,
          });
        }

        // 输出截断
        const lines = out.trim().split('\n');
        if (lines.length > 500) {
          const truncated = lines.slice(0, 500).join('\n');
          return resolve({
            output: truncated + `\n\n[WARNING] 输出被截断（共 ${lines.length} 行匹配，仅显示前 500 行）。请提供更精确的 query。`,
            isError: false,
          });
        }

        resolve({
          output: out.trim(),
          isError: false,
        });
      });

      // 超时保护
      setTimeout(() => {
        proc.kill();
        resolve({
          output: `[ERROR] 搜索执行超时 (10s)。请尝试更精确的检索匹配。`,
          isError: true,
        });
      }, 10000);
    });
  },
});
