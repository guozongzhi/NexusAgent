/**
 * FileReadTool — 读取文件内容
 * 支持指定行范围、自动检测编码、图片读取（base64）
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

/** 支持的图片 MIME 类型 */
const IMAGE_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
};

/** 最大图片大小 5MB */
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

export const FileReadTool = registerTool({
  name: 'file_read',
  description: '读取指定文件的内容。支持文本文件（可选行范围）和图片文件（返回 base64）。',
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

      // ── 图片文件检测 ──
      const ext = path.extname(absPath).toLowerCase();
      const mimeType = IMAGE_EXTENSIONS[ext];
      if (mimeType) {
        if (fileStat.size > MAX_IMAGE_SIZE) {
          return { output: `[ERROR] 图片文件过大 (${(fileStat.size / 1024 / 1024).toFixed(1)}MB > 5MB 限制)`, isError: true };
        }
        const buffer = await readFile(absPath);
        const base64 = buffer.toString('base64');
        return {
          output: `[图片文件] ${absPath} (${mimeType}, ${(fileStat.size / 1024).toFixed(1)}KB)`,
          images: [{ type: mimeType, base64 }],
        };
      }

      // ── 文本文件读取 ──
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
