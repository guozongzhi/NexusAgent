/**
 * ListDirTool — 列出目录内容
 * 返回目录下的文件和子目录列表
 */
import { z } from 'zod';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { registerTool } from '../Tool.ts';
import type { ToolResult, ToolUseContext } from '../types/index.ts';
import { validatePath } from '../security/pathGuard.ts';

const inputSchema = z.object({
  dirPath: z.string().describe('目录的绝对路径或相对于工作目录的路径，默认为当前目录'),
  recursive: z.boolean().optional().describe('是否递归列出子目录内容，默认 false'),
  maxDepth: z.number().optional().describe('递归深度上限，默认 3'),
});

/** 单个条目最大返回数 */
const MAX_ENTRIES = 500;

export const ListDirTool = registerTool({
  name: 'list_dir',
  description: '列出指定目录的文件和子目录。可选递归模式以查看目录树结构。忽略 node_modules 和 .git。',
  inputSchema,
  isReadOnly: true,

  async call(input, context): Promise<ToolResult> {
    const dirPath = input.dirPath || '.';
    const absPath = path.isAbsolute(dirPath)
      ? dirPath
      : path.resolve(context.cwd, dirPath);

    // 路径安全校验
    const pathCheck = validatePath(absPath, context.cwd);
    if (!pathCheck.safe) {
      return { output: `[BLOCKED] ${pathCheck.error}`, isError: true };
    }

    const recursive = input.recursive ?? false;
    const maxDepth = input.maxDepth ?? 3;

    try {
      const entries: string[] = [];
      await listDir(absPath, '', recursive, maxDepth, 0, entries);

      if (entries.length === 0) {
        return { output: `目录为空: ${absPath}` };
      }

      const truncated = entries.length > MAX_ENTRIES;
      const result = entries.slice(0, MAX_ENTRIES).join('\n');
      return {
        output: `目录: ${absPath} (${entries.length} 项)${truncated ? ' [已截断]' : ''}\n\n${result}`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { output: `[ERROR] 列出目录失败: ${msg}`, isError: true };
    }
  },
});

/** 递归列出目录 */
async function listDir(
  basePath: string,
  prefix: string,
  recursive: boolean,
  maxDepth: number,
  currentDepth: number,
  entries: string[],
): Promise<void> {
  const items = await readdir(basePath, { withFileTypes: true });

  // 排序：目录在前，文件在后
  items.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const item of items) {
    // 跳过常见干扰目录
    if (item.name === 'node_modules' || item.name === '.git') continue;
    if (entries.length >= MAX_ENTRIES) return;

    const relativePath = prefix ? `${prefix}/${item.name}` : item.name;

    if (item.isDirectory()) {
      entries.push(`${relativePath}/`);
      if (recursive && currentDepth < maxDepth) {
        await listDir(
          path.join(basePath, item.name),
          relativePath,
          recursive,
          maxDepth,
          currentDepth + 1,
          entries,
        );
      }
    } else {
      // 获取文件大小
      try {
        const fileStat = await stat(path.join(basePath, item.name));
        const size = formatSize(fileStat.size);
        entries.push(`${relativePath}  (${size})`);
      } catch {
        entries.push(relativePath);
      }
    }
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
