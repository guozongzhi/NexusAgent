/**
 * FileEditTool — 文件编辑工具
 *
 * 重构版（Claude Code 对齐）：
 * - Levenshtein 模糊匹配：精确匹配失败时自动用编辑距离搜索最近匹配段
 * - 缩进归一化：自动对齐 tab/space 差异
 * - 原子写入：先写 .tmp → rename，失败不损坏原文件
 * - Diff 输出：返回 unified diff 格式给 LLM
 * - 多处编辑支持：edits 数组参数
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { registerTool } from '../Tool.ts';
import type { ToolResult } from '../types/index.ts';
import { validatePath, validateWriteSize, validateSensitivePath } from '../security/pathGuard.ts';

// ─── 模糊匹配引擎 ─────────────────────────────────────

/**
 * 计算 Levenshtein 编辑距离（优化版：仅保留两行）
 */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // 大字符串时截断（避免 O(mn) 爆内存）
  if (m > 5000 || n > 5000) return Math.abs(m - n);

  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]!
        : Math.min(prev[j - 1]!, prev[j]!, curr[j - 1]!) + 1;
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

/**
 * 缩进归一化：将 tab 替换为 2 空格，去除尾部空白
 */
function normalizeIndent(text: string): string {
  return text
    .replace(/\t/g, '  ')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n');
}

/**
 * 在文件内容中搜索 search 字符串的最佳匹配位置
 * 先尝试精确匹配 → 缩进归一化匹配 → Levenshtein 模糊匹配
 */
function findBestMatch(
  fileContent: string,
  search: string,
): { match: string; score: number; method: 'exact' | 'normalized' | 'fuzzy' } | null {
  // 1. 精确匹配
  if (fileContent.includes(search)) {
    return { match: search, score: 0, method: 'exact' };
  }

  // 2. 换行符归一化 + trim
  const normSearch = search.replace(/\r\n/g, '\n').trim();
  const normContent = fileContent.replace(/\r\n/g, '\n');
  if (normContent.includes(normSearch)) {
    return { match: normSearch, score: 0, method: 'normalized' };
  }

  // 3. 缩进归一化匹配
  const indentNormSearch = normalizeIndent(normSearch);
  const contentLines = normContent.split('\n');
  const searchLines = indentNormSearch.split('\n');

  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    const window = contentLines.slice(i, i + searchLines.length);
    const normWindow = normalizeIndent(window.join('\n'));
    if (normWindow === indentNormSearch) {
      // 找到了归一化匹配，返回原始文本
      const originalMatch = contentLines.slice(i, i + searchLines.length).join('\n');
      return { match: originalMatch, score: 0, method: 'normalized' };
    }
  }

  // 4. Levenshtein 模糊匹配（滑动窗口）
  const searchLen = searchLines.length;
  let bestScore = Infinity;
  let bestMatch: string | null = null;
  // 限制搜索窗口大小，避免超大文件卡死
  const maxWindows = Math.min(contentLines.length - searchLen + 1, 2000);

  for (let i = 0; i < maxWindows; i++) {
    const window = contentLines.slice(i, i + searchLen).join('\n');
    const dist = levenshtein(normalizeIndent(window), indentNormSearch);
    // 编辑距离阈值：不超过搜索字符串长度的 20%
    const threshold = Math.max(normSearch.length * 0.2, 10);
    if (dist < bestScore && dist <= threshold) {
      bestScore = dist;
      bestMatch = window;
    }
  }

  if (bestMatch !== null) {
    return { match: bestMatch, score: bestScore, method: 'fuzzy' };
  }

  return null;
}

// ─── Unified Diff 生成 ──────────────────────────────────

/**
 * 生成简化版 unified diff
 */
function generateDiff(filePath: string, oldText: string, newText: string): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  const diff: string[] = [`--- a/${path.basename(filePath)}`, `+++ b/${path.basename(filePath)}`];

  // 简化 diff：找出变更区域
  let i = 0, j = 0;
  // 找到第一个不同的行
  while (i < oldLines.length && i < newLines.length && oldLines[i] === newLines[i]) i++;
  // 找到最后一个不同的行
  let oi = oldLines.length - 1, ni = newLines.length - 1;
  while (oi > i && ni > i && oldLines[oi] === newLines[ni]) { oi--; ni--; }

  // 上下文行数
  const ctxBefore = Math.max(0, i - 3);
  const ctxAfterOld = Math.min(oldLines.length - 1, oi + 3);
  const ctxAfterNew = Math.min(newLines.length - 1, ni + 3);

  diff.push(`@@ -${ctxBefore + 1},${ctxAfterOld - ctxBefore + 1} +${ctxBefore + 1},${ctxAfterNew - ctxBefore + 1} @@`);

  // 前面的上下文
  for (let k = ctxBefore; k < i; k++) {
    diff.push(` ${oldLines[k]}`);
  }
  // 删除的行
  for (let k = i; k <= oi; k++) {
    diff.push(`-${oldLines[k]}`);
  }
  // 新增的行
  for (let k = i; k <= ni; k++) {
    diff.push(`+${newLines[k]}`);
  }
  // 后面的上下文
  for (let k = oi + 1; k <= ctxAfterOld; k++) {
    diff.push(` ${oldLines[k]}`);
  }

  return diff.join('\n');
}

// ─── 原子写入 ────────────────────────────────────────

/**
 * 原子写入文件：先写 .tmp 再 rename
 */
async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tmpPath = `${filePath}.nexus.tmp`;
  try {
    await fs.writeFile(tmpPath, content, 'utf-8');
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    // 清理临时文件
    try { await fs.unlink(tmpPath); } catch {}
    throw err;
  }
}

// ─── 工具注册 ────────────────────────────────────────

export const FileEditTool = registerTool({
  name: 'file_edit',
  description: '编辑现有文件。提供文件中需要被替换的精确原文本 (old_string) 和新文本 (new_string)。支持模糊匹配：当精确匹配失败时，自动尝试缩进归一化和编辑距离匹配。返回 unified diff 格式的变更预览。',
  inputSchema: z.object({
    file_path: z.string().describe('绝对路径或基于工作目录的相对路径'),
    old_string: z.string().describe('需要被替换的原文本，建议包含上下各几行用于定界'),
    new_string: z.string().describe('用来替换的新字符串内容'),
    replace_all: z.boolean().optional().describe('是否将全文中所有的 old_string 替换'),
  }),
  isReadOnly: false,

  async call(input, context): Promise<ToolResult> {
    const { file_path, old_string, new_string, replace_all } = input;
    const targetPath = path.resolve(context.cwd, file_path);

    // 路径安全校验
    const pathCheck = validatePath(targetPath, context.cwd);
    if (!pathCheck.safe) {
      return { output: `[BLOCKED] ${pathCheck.error}`, isError: true };
    }

    // 敏感文件保护
    const sensitiveCheck = validateSensitivePath(targetPath);
    if (!sensitiveCheck.safe) {
      return { output: `[BLOCKED] ${sensitiveCheck.reason}`, isError: true };
    }

    // 内容大小校验
    const sizeCheck = validateWriteSize(new_string);
    if (!sizeCheck.safe) {
      return { output: `[BLOCKED] ${sizeCheck.error}`, isError: true };
    }

    try {
      const content = await fs.readFile(targetPath, 'utf-8');
      const fileText = content.replace(/\r\n/g, '\n');
      const searchStr = old_string.replace(/\r\n/g, '\n');
      const newStr = new_string.replace(/\r\n/g, '\n');

      // 使用增强的模糊匹配引擎
      const matchResult = findBestMatch(fileText, searchStr);

      if (!matchResult) {
        return {
          output: `[ERROR] 找不到要替换的代码块。模糊匹配也未找到足够接近的内容。
请确保:
1. \`old_string\` 中的缩进、空格、空行与实际文件尽量一致
2. 选取唯一且简短的关键代码块进行定位
3. 可先使用 file_read 工具查看目标文件的精确内容`,
          isError: true,
        };
      }

      const { match: actualOldStr, score, method } = matchResult;

      // 模糊匹配警告
      let fuzzyWarning = '';
      if (method === 'fuzzy') {
        fuzzyWarning = `\n⚠ 使用了模糊匹配（编辑距离: ${score}），请验证替换结果是否正确。`;
      } else if (method === 'normalized') {
        fuzzyWarning = `\n💡 通过缩进归一化匹配成功。`;
      }

      // 检查重复匹配
      const occurrences = fileText.split(actualOldStr).length - 1;
      if (occurrences > 1 && !replace_all) {
        return {
          output: `[ERROR] 目标字符串在文件中存在 ${occurrences} 处匹配项。\n请通过缩小/扩大 \`old_string\` 上下文边界使其唯一，或者设置 \`replace_all: true\` 以全局替换。`,
          isError: true,
        };
      }

      // 执行替换
      const updatedContent = replace_all
        ? fileText.split(actualOldStr).join(newStr)
        : fileText.replace(actualOldStr, newStr);

      // 原子写入
      await atomicWrite(targetPath, updatedContent);

      // 生成 diff
      const diff = generateDiff(targetPath, fileText, updatedContent);
      const oldLines = fileText.split('\n').length;
      const newLines = updatedContent.split('\n').length;

      return {
        output: `成功更新了文件: ${targetPath} (${oldLines} → ${newLines} 行)${fuzzyWarning}\n\n\`\`\`diff\n${diff}\n\`\`\``,
        isError: false,
      };

    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          output: `[ERROR] 编辑失败：文件不存在 ${targetPath}。如果是新文件，请使用 file_write 工具。`,
          isError: true,
        };
      }
      return {
        output: `[ERROR] 文件读写异常: ${String(err)}`,
        isError: true,
      };
    }
  },
});
