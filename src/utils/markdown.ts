/**
 * 极简的终端 Markdown 渲染工具
 * 黑白灰色系 — 不使用彩色
 */
import chalk from 'chalk';

export function renderMarkdown(text: string): string {
  if (!text) return '';

  let output = text;

  // Code Block ```lang...```
  output = output.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const header = chalk.inverse(` ${lang || 'code'} `);
    const body = chalk.dim(code.trimEnd());
    return `\n${header}\n${body}\n`;
  });

  // Inline Code `code`
  output = output.replace(/`([^`]+)`/g, (_, code) => {
    return chalk.bold(code);
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
    return chalk.dim.italic(`│ ${quote}`);
  });

  // Headers # Header
  output = output.replace(/^(#{1,6})\s+(.+)$/gm, (_, _hashes, title) => {
    return chalk.bold.underline(title);
  });

  return output;
}
