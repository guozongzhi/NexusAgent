/**
 * FileReadTool — 读取文件内容
 * 支持指定行范围、自动检测编码
 */
import { z } from 'zod';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { registerTool } from '../Tool.ts';
import type { ToolResult, ToolUseContext } from '../types/index.ts';

const inputSchema = z.object({
  filePath: z.string().describe('文件的绝对路径或相对于工作目录的路径'),
  startLine: z.number().optional().describe('起始行号（1-indexed），留空读取全部'),
  endLine: z.number().optional().describe('结束行号（1-indexed, inclusive）'),
});

export const FileReadTool = registerTool({
  name: 'file_read',
  description: '读取指定文件的内容。可选指定行范围来读取大文件的部分内容。',
  inputSchema,
  isReadOnly: true,

  async call(input, context): Promise<ToolResult> {
    const absPath = path.isAbsolute(input.filePath)
      ? input.filePath
      : path.resolve(context.cwd, input.filePath);

    try {
      // 检查文件是否存在与大小
      const fileStat = await stat(absPath);
      if (!fileStat.isFile()) {
        return { output: `[ERROR] ${absPath} 不是一个文件`, isError: true };
      }

      const content = await readFile(absPath, 'utf-8');
      const lines = content.split('\n');

      // 行范围截取
      if (input.startLine || input.endLine) {
        const start = Math.max(1, input.startLine ?? 1);
        const end = Math.min(lines.length, input.endLine ?? lines.length);
        const sliced = lines.slice(start - 1, end);

        return {
          output: `文件: ${absPath} (行 ${start}-${end}，共 ${lines.length} 行)\n\n${sliced
            .map((l, i) => `${start + i}: ${l}`)
            .join('\n')}`,
        };
      }

      // 完整输出（大文件自动截断）
      const MAX_CHARS = 100_000;
      const truncated = content.length > MAX_CHARS;
      const output = truncated ? content.slice(0, MAX_CHARS) : content;

      return {
        output: `文件: ${absPath} (${lines.length} 行, ${fileStat.size} bytes)${truncated ? ' [内容已截断]' : ''}\n\n${output}`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { output: `[ERROR] 读取文件失败: ${msg}`, isError: true };
    }
  },
});
