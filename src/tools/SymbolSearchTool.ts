import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { registerTool } from '../Tool.ts';
import type { ToolResult } from '../types/index.ts';

const execAsync = promisify(exec);

const inputSchema = z.object({
  query: z.string().describe('要搜索的符号名称（如类名、函数名）'),
  language: z.enum(['typescript', 'javascript', 'go', 'python', 'all']).default('all').describe('目标语言，用于优化正则'),
});

/**
 * 针对不同语言生成符号定义正则
 */
function getSymbolPattern(query: string, lang: string): string {
  // 转义正则特殊字符
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  switch (lang) {
    case 'typescript':
    case 'javascript':
      // 匹配 export class Name, function Name, interface Name, const Name = ...
      return `(export\\s+)?(class|function|interface|type|const|let|enum)\\s+${escaped}(\\s|\\(|:|$)`;
    
    case 'go':
      // 匹配 func Name, type Name
      return `(func|type)\\s+(\\([^)]+\\)\\s+)?${escaped}(\\s|\\(|$)`;
    
    case 'python':
      // 匹配 class Name, def Name
      return `(class|def)\\s+${escaped}(\\s|\\(|:)`;
    
    default:
      // 通用：匹配单词边界后的 query
      return `\\b${escaped}\\b`;
  }
}

export const SymbolSearchTool = registerTool({
  name: 'symbol_search',
  description: '【核心高频工具】在全库范围内瞬间定位函数、类、接口或常量的定义位置。比 grep 更精准，适合在复杂项目中快速跳转和理解代码骨架。',
  inputSchema,
  isReadOnly: true,
  authType: 'safe', // 仅搜索，标记为安全
  
  async call(input, context): Promise<ToolResult> {
    const { query, language } = input;
    const pattern = getSymbolPattern(query, language);
    
    try {
      // 使用 grep -rEn 执行搜索，排除常见干扰目录
      // -E 使用扩展正则
      // -I 忽略二进制文件
      const excludeArgs = [
        '--exclude-dir=node_modules',
        '--exclude-dir=.git',
        '--exclude-dir=dist',
        '--exclude-dir=build',
        '--exclude-dir=.next',
        '--exclude=*.log',
        '--exclude=*.bin',
      ].join(' ');

      // 为了安全，参数需要转义处理
      const command = `grep -rEnI ${excludeArgs} "${pattern}" .`;
      
      const { stdout } = await execAsync(command, { 
        cwd: context.cwd,
        timeout: 10000, // 10秒超时
      });

      if (!stdout.trim()) {
        return { output: `[INFO] 未在项目中找到符号 \`${query}\` 的定义。` };
      }

      const lines = stdout.trim().split('\n');
      const count = lines.length;
      const displayLines = lines.slice(0, 30); // 最多展示30条

      let output = `[SUCCESS] 找到 ${count} 处可能的 \`${query}\` 定义信号：\n\n`;
      output += displayLines.map(line => `📍 ${line}`).join('\n');
      
      if (count > 30) {
        output += `\n\n... 还有 ${count - 30} 处匹配项已隐藏。请尝试更精确的查询。`;
      }

      return { output };
    } catch (err: any) {
      if (err.code === 1) {
         return { output: `[INFO] 未在项目中找到符号 \`${query}\` 的定义。` };
      }
      return { output: `[ERROR] 符号检索失败: ${err.message}`, isError: true };
    }
  },
});
