import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { registerTool } from '../Tool.ts';
import type { ToolResult } from '../types/index.ts';

/**
 * 标准化空显字符串，应对 LLM 换行符输出误差
 */
function normalizeString(str: string): string {
  // 统一换行符，去除首尾空白
  return str.replace(/\r\n/g, '\n').trim();
}

/**
 * 在源文件中模糊查找实际的需要被替换的代码片段
 */
function findActualString(fileContent: string, searchString: string): string | null {
  if (fileContent.includes(searchString)) {
    return searchString; // 精确匹配
  }
  
  // 尝试标准化以后对比（去除两端冗余缩进后再匹配）
  const normalizedSearch = normalizeString(searchString);
  if (!normalizedSearch) return null;

  // 粗略处理：如果是基于代码行的，可以尝试只匹配行的核心内容。
  // 简易起见，这里假设文件内容和搜索内容的纯净版能匹配上
  // 这里可以写更复杂的忽略空白符策略，目前如果精确匹配不到并且首尾trim后依然不行，则抛错要求重试
  
  const contentStart = fileContent.indexOf(normalizedSearch.substring(0, Math.min(20, normalizedSearch.length)));
  if (contentStart !== -1) {
    // 作为一个兜底策略，可以考虑更高级的 diff，但大部分情况 LLM 会重新输出精确的代码
  }
  
  return null;
}

export const FileEditTool = registerTool({
  name: 'file_edit',
  description: '编辑现有文件。必须提供文件中需要被替换的完整精确原文本 (old_string) 和新文本 (new_string)。若找不到 old_string 会执行失败。',
  inputSchema: z.object({
    file_path: z.string().describe('绝对路径或基于工作目录的相对绝对路径'),
    old_string: z.string().describe('必须精确匹配原文件中的字符串，建议包含上下各几行用于定界。若不匹配将提示错误。'),
    new_string: z.string().describe('用来替换的新字符串内容'),
    replace_all: z.boolean().optional().describe('是否将全文中所有的 old_string 替换。如果是单个修改请设为 false（推荐）。')
  }),
  isReadOnly: false,
  async call(input, context): Promise<ToolResult> {
    const { file_path, old_string, new_string, replace_all } = input;

    const targetPath = path.resolve(context.cwd, file_path);

    try {
      const content = await fs.readFile(targetPath, 'utf-8');
      
      const fileText = content.replace(/\r\n/g, '\n');
      const searchStr = old_string.replace(/\r\n/g, '\n');
      const newStr = new_string.replace(/\r\n/g, '\n');

      const actualOldStr = findActualString(fileText, searchStr);

      if (!actualOldStr) {
        return {
          output: `[ERROR] 找不到要替换的代码块，原文件内并未包含提供的 \`old_string\`。
请确保:
1. \`old_string\` 中的缩进、空格、空行与实际文件 100% 相同。
2. 尽量选取唯一且简短的关键代码块（附带上下各1行定界）进行定位，而不要选取过长的冗余内容。`,
          isError: true,
        };
      }

      const occurrences = fileText.split(actualOldStr).length - 1;
      if (occurrences > 1 && !replace_all) {
         return {
           output: `[ERROR] 目标字符串在文件中存在 ${occurrences} 处匹配项，请通过缩小/扩大 \`old_string\` 上下文边界使其唯一，或者设置 \`replace_all: true\` 以全局替换。`,
           isError: true,
         };
      }

      const updatedContent = replace_all
        ? fileText.split(actualOldStr).join(newStr)
        : fileText.replace(actualOldStr, newStr);

      await fs.writeFile(targetPath, updatedContent, 'utf-8');
      
      // 做一个简单的体积差异和行数报告
      const oldLines = fileText.split('\n').length;
      const newLines = updatedContent.split('\n').length;

      return {
        output: `成功更新了文件: ${targetPath} (旧行数: ${oldLines}, 新行数: ${newLines})`,
        isError: false,
      };
      
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          output: `[ERROR] 编辑失败：文件不存在 ${targetPath}。如果是新文件，请尝试使用 file_write 工具。`,
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
