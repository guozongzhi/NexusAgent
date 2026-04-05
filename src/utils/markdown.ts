/**
 * 极简的终端 Markdown 渲染工具
 * 采用正则匹配替换为 ANSI 颜色转义字符
 */
import chalk from 'chalk';

export function renderMarkdown(text: string): string {
  if (!text) return '';

  let output = text;

  // Code Block ```lang...```
  output = output.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const header = chalk.bgGray.black(` ${lang || 'code'} `);
    const body = chalk.gray(code.trimEnd());
    return `\n${header}\n${body}\n`;
  });

  // Inline Code `code`
  output = output.replace(/`([^`]+)`/g, (_, code) => {
    return chalk.cyan(code);
  });

  // Bold **text**
  output = output.replace(/\*\*([^*]+)\*\*/g, (_, boldText) => {
    return chalk.bold(boldText);
  });

  // Italic *text*
  output = output.replace(/\*([^*]+)\*/g, (_, italicText) => {
    return chalk.italic(italicText);
  });

  // Quotes > text
  output = output.replace(/^>\s+(.+)$/gm, (_, quote) => {
    return chalk.dim.italic(`| ${quote}`);
  });

  // Headers # Header
  output = output.replace(/^(#{1,6})\s+(.+)$/gm, (_, hashes, title) => {
    return chalk.magenta.bold(`${hashes} ${title}`);
  });

  return output;
}
