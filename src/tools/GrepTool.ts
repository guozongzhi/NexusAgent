import { spawn } from 'node:child_process';
import { z } from 'zod';
import { registerTool } from '../Tool.ts';
import type { ToolResult } from '../types/index.ts';

/**
 * 包装 Bash Grep 以搜寻工作区
 */
export const GrepTool = registerTool({
  name: 'grep',
  description: '在工作区全域使用 grep 正则搜索文本以定位内容（忽略 node_modules 和 .git）。',
  inputSchema: z.object({
    query: z.string().describe('搜索的文本或扩展正则表达式。'),
    include: z.string().optional().describe('可选参数。限制检索的文件路径模式（如 *.ts 或 src/*）。')
  }),
  isReadOnly: true,
  async call(input, context): Promise<ToolResult> {
    const { query, include } = input;

    return new Promise((resolve) => {
      const args = [
        '-rnE', // recursive, line numbers, extended regex
        '--exclude-dir=node_modules',
        '--exclude-dir=.git',
        '--exclude-dir=.next',
        '--exclude-dir=dist',
        query,
        '.'      
      ];
      
      if (include) {
         // grep 原生 include 参数语法: --include="*.ts"
         args.splice(args.length - 1, 0, `--include=${include}`);
      }

      const proc = spawn('grep', args, { cwd: context.cwd });
      
      let out = '';
      let err = '';

      proc.stdout.on('data', (d) => (out += d.toString()));
      proc.stderr.on('data', (d) => (err += d.toString()));

      proc.on('close', (code) => {
        // grep 找不到匹配项时返回 code 1
        if (code === 1 && out.trim() === '') {
           return resolve({
             output: `未能找到包含 "${query}" 的内容。`,
             isError: false
           });
        }
        
        if (code !== 0 && code !== 1) {
           return resolve({
             output: `[ERROR] Grep 执行失败 (code ${code}): ${err}`,
             isError: true
           });
        }
        
        // 限制输出结果大小，避免撑爆 Token
        const lines = out.trim().split('\n');
        if (lines.length > 500) {
          const truncated = lines.slice(0, 500).join('\n');
          return resolve({
            output: truncated + `\n\n[WARNING] 输出被截断（超过500行）。请提供更精确的 query。`,
            isError: false
          });
        }
        
        resolve({
          output: out.trim(),
          isError: false
        });
      });
      
      // 防止进程长时间挂死
      setTimeout(() => {
        proc.kill();
        resolve({
          output: `[ERROR] Grep 执行超时。请尝试更精确的检索匹配。`,
          isError: true
        });
      }, 10000);
    });
  },
});
