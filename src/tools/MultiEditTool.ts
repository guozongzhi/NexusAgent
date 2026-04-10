/**
 * MultiEditTool — 批量多文件多位置编辑
 *
 * 单次调用同时编辑多个文件的多个位置
 * 支持事务语义：全部成功或全部回滚
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { registerTool } from '../Tool.ts';
import type { ToolResult } from '../types/index.ts';
import { validatePath, validateWriteSize, validateSensitivePath } from '../security/pathGuard.ts';

const editSchema = z.object({
  file_path: z.string().describe('文件的绝对路径或相对路径'),
  old_string: z.string().describe('需要被替换的原文本'),
  new_string: z.string().describe('替换后的新文本'),
});

const inputSchema = z.object({
  edits: z.array(editSchema).min(1).max(20).describe('编辑操作列表，每项包含 file_path、old_string、new_string'),
});

/**
 * 原子写入
 */
async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tmpPath = `${filePath}.nexus.tmp`;
  try {
    await fs.writeFile(tmpPath, content, 'utf-8');
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    try { await fs.unlink(tmpPath); } catch {}
    throw err;
  }
}

export const MultiEditTool = registerTool({
  name: 'multi_edit',
  description: '批量编辑多个文件的多个位置。支持事务语义：全部成功或全部回滚。最多一次 20 处编辑。',
  inputSchema,
  isReadOnly: false,

  async call(input, context): Promise<ToolResult> {
    const { edits } = input;
    const results: string[] = [];
    const backups = new Map<string, string>(); // 文件路径 → 原始内容

    try {
      // Phase 1: 预校验所有编辑
      for (const edit of edits) {
        const targetPath = path.resolve(context.cwd, edit.file_path);

        const pathCheck = validatePath(targetPath, context.cwd);
        if (!pathCheck.safe) {
          return { output: `[BLOCKED] ${edit.file_path}: ${pathCheck.error}`, isError: true };
        }

        const sensitiveCheck = validateSensitivePath(targetPath);
        if (!sensitiveCheck.safe) {
          return { output: `[BLOCKED] ${edit.file_path}: ${sensitiveCheck.reason}`, isError: true };
        }

        const sizeCheck = validateWriteSize(edit.new_string);
        if (!sizeCheck.safe) {
          return { output: `[BLOCKED] ${edit.file_path}: ${sizeCheck.error}`, isError: true };
        }

        // 缓存文件内容
        if (!backups.has(targetPath)) {
          try {
            const content = await fs.readFile(targetPath, 'utf-8');
            backups.set(targetPath, content);
          } catch (err: any) {
            return { output: `[ERROR] 无法读取 ${edit.file_path}: ${err.message}`, isError: true };
          }
        }
      }

      // Phase 2: 执行所有编辑（在内存中操作）
      const updatedFiles = new Map<string, string>(); // 文件路径 → 更新后的内容

      for (const edit of edits) {
        const targetPath = path.resolve(context.cwd, edit.file_path);
        let content = updatedFiles.get(targetPath) || backups.get(targetPath)!;

        const searchStr = edit.old_string.replace(/\r\n/g, '\n');
        const newStr = edit.new_string.replace(/\r\n/g, '\n');
        content = content.replace(/\r\n/g, '\n');

        if (!content.includes(searchStr)) {
          // 回滚所有已写入的文件
          for (const [filePath, original] of backups) {
            if (updatedFiles.has(filePath)) {
              try { await atomicWrite(filePath, original); } catch {}
            }
          }
          return {
            output: `[ERROR] 在 ${edit.file_path} 中找不到要替换的内容。所有编辑已回滚。\n未找到的文本: ${searchStr.substring(0, 100)}...`,
            isError: true,
          };
        }

        content = content.replace(searchStr, newStr);
        updatedFiles.set(targetPath, content);
        results.push(`✓ ${path.basename(edit.file_path)}: 替换成功`);
      }

      // Phase 3: 快照备份与原子写入所有文件
      const { FileVault } = await import('../services/sandbox/FileVault.ts');
      await (await FileVault.getInstance()).createSnapshot(Array.from(updatedFiles.keys()));

      for (const [filePath, content] of updatedFiles) {
        await atomicWrite(filePath, content);
      }

      return {
        output: `[INFO] 撤销点已就绪，如遇问题可用 /undo 回滚。\n批量编辑完成（${edits.length} 处修改，${updatedFiles.size} 个文件）\n${results.join('\n')}`,
        isError: false,
      };

    } catch (err: any) {
      // 紧急回滚
      for (const [filePath, original] of backups) {
        try { await atomicWrite(filePath, original); } catch {}
      }
      return {
        output: `[ERROR] 批量编辑失败，已回滚所有文件: ${err.message}`,
        isError: true,
      };
    }
  },
});
