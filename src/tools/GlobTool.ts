import path from 'node:path';
import { z } from 'zod';
import { registerTool } from '../Tool.ts';
import type { ToolResult } from '../types/index.ts';

/**
 * 限制最大返回项，防止大仓导致上下文撑爆
 */
const MAX_RESULTS = 500;

export const GlobTool = registerTool({
  name: 'glob',
  description: '搜索匹配指定 glob path pattern 的所有文件。返回相对于工作目录的路径列表。忽略 .git, node_modules 等干扰项。',
  inputSchema: z.object({
    pattern: z.string().describe('glob 规则，例如 src/**/*.ts 或者 **/*.md'),
  }),
  isReadOnly: true,
  async call(input, context): Promise<ToolResult> {
    const { pattern } = input;

    try {
      // @ts-ignore: Bun 全局拥有 Glob 对象
      const globObj = new Bun.Glob(pattern);
      
      const files: string[] = [];
      let truncated = false;
      
      // 遍历基于 context.cwd 的执行扫描
      for await (const file of globObj.scan({ cwd: context.cwd, onlyFiles: true })) {
        // 排除常见干扰黑名单
        if (file.includes('node_modules/') || file.includes('.git/')) {
           continue;
        }

        files.push(file);

        if (files.length > MAX_RESULTS) {
          truncated = true;
          break;
        }
      }

      if (files.length === 0) {
        return {
          output: `未找到符合模式 \`${pattern}\` 的文件。`,
          isError: false,
        };
      }

      let res = files.join('\n');
      if (truncated) {
        res += `\n\n[WARNING] 匹配项超过 ${MAX_RESULTS} 个，已截断。请尝试提供更具体的检索模式。`;
      }

      return {
        output: res,
        isError: false,
      };
      
    } catch (err: unknown) {
      return {
        output: `[ERROR] 构建 Glob 搜索失败: ${String(err)}`,
        isError: true,
      };
    }
  },
});
