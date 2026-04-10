/**
 * FileWriteTool — 创建或覆盖写入文件
 *
 * 重构版：
 * - 原子写入：先写 .nexus.tmp 再 rename
 * - 自动创建父目录
 */
import { z } from 'zod';
import { writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { registerTool } from '../Tool.ts';
import type { ToolResult, ToolUseContext } from '../types/index.ts';
import { validatePath, validateWriteSize, validateSensitivePath } from '../security/pathGuard.ts';

const inputSchema = z.object({
  filePath: z.string().describe('文件的绝对路径或相对于工作目录的路径'),
  content: z.string().describe('要写入的完整文件内容'),
});

/**
 * 原子写入文件
 */
async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tmpPath = `${filePath}.nexus.tmp`;
  try {
    await writeFile(tmpPath, content, 'utf-8');
    await rename(tmpPath, filePath);
  } catch (err) {
    try { await unlink(tmpPath); } catch {}
    throw err;
  }
}

export const FileWriteTool = registerTool({
  name: 'file_write',
  description: '创建新文件或覆盖写入已有文件的全部内容。父目录会自动创建。使用原子写入确保文件完整性。',
  inputSchema,
  isReadOnly: false,

  async call(input, context): Promise<ToolResult> {
    const absPath = path.isAbsolute(input.filePath)
      ? input.filePath
      : path.resolve(context.cwd, input.filePath);

    // 路径安全校验
    const pathCheck = validatePath(absPath, context.cwd);
    if (!pathCheck.safe) {
      return { output: `[BLOCKED] ${pathCheck.error}`, isError: true };
    }

    // 敏感文件保护
    const sensitiveCheck = validateSensitivePath(absPath);
    if (!sensitiveCheck.safe) {
      return { output: `[BLOCKED] ${sensitiveCheck.reason}`, isError: true };
    }

    // 写入大小校验
    const sizeCheck = validateWriteSize(input.content);
    if (!sizeCheck.safe) {
      return { output: `[BLOCKED] ${sizeCheck.error}`, isError: true };
    }

    try {
      const { FileVault } = await import('../services/sandbox/FileVault.ts');
      await (await FileVault.getInstance()).createSnapshot([absPath]);

      // 确保父目录存在
      await mkdir(path.dirname(absPath), { recursive: true });

      // 原子写入
      await atomicWrite(absPath, input.content);

      const lines = input.content.split('\n').length;
      const bytes = Buffer.byteLength(input.content, 'utf-8');

      return {
        output: `[INFO] 撤销点已就绪，如遇问题可用 /undo 回滚。\n文件已写入: ${absPath} (${lines} 行, ${bytes} bytes)`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { output: `[ERROR] 写入文件失败: ${msg}`, isError: true };
    }
  },
});
