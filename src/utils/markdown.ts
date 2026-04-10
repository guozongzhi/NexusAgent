/**
 * 增强版终端 Markdown 渲染工具
 *
 * Claude Code 对齐：
 * - 代码块语法高亮（关键字着色）
 * - Diff 渲染（+绿/-红/@@青）
 * - 表格对齐渲染
 * - 有序/无序列表缩进
 * - OSC 8 终端超链接
 * - 引用块竖线样式
 */
import chalk from 'chalk';

// ─── 简易语法高亮 ──────────────────────────────────────

/** 通用编程关键字（JS/TS/Python/Go/Rust 混合） */
const KEYWORDS = new Set([
  // JS/TS
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
  'class', 'extends', 'import', 'export', 'default', 'from', 'async', 'await',
  'try', 'catch', 'throw', 'new', 'typeof', 'instanceof', 'type', 'interface',
  'enum', 'implements', 'abstract', 'readonly', 'private', 'public', 'protected',
  'static', 'super', 'this', 'yield', 'switch', 'case', 'break', 'continue',
  // Python
  'def', 'class', 'import', 'from', 'return', 'if', 'elif', 'else', 'for',
  'while', 'try', 'except', 'finally', 'with', 'as', 'True', 'False', 'None',
  'and', 'or', 'not', 'in', 'is', 'lambda', 'pass', 'raise', 'self',
  // Go/Rust
  'fn', 'let', 'mut', 'pub', 'mod', 'use', 'struct', 'impl', 'trait',
  'match', 'loop', 'go', 'func', 'package', 'defer', 'chan', 'select',
]);

const BUILTINS = new Set([
  'console', 'process', 'require', 'module', 'exports',
  'setTimeout', 'setInterval', 'Promise', 'Array', 'Object', 'String', 'Number',
  'Boolean', 'Map', 'Set', 'Error', 'JSON', 'Math', 'Date', 'RegExp',
  'print', 'len', 'range', 'dict', 'list', 'tuple', 'set', 'int', 'str', 'float',
]);

/**
 * 简易代码高亮（基于正则的 token 着色）
 */
function highlightCode(code: string, lang: string): string {
  return code.split('\n').map(line => {
    let result = line;
    // 注释（//、#）
    result = result.replace(/(\/\/.*|#.*)$/gm, (m) => chalk.dim.italic(m));
    // 字符串（'...' 和 "..."）
    result = result.replace(/(["'])(?:(?!\1|\\).|\\.)*\1/g, (m) => chalk.green(m));
    // 数字
    result = result.replace(/\b(\d+\.?\d*)\b/g, (m) => chalk.yellow(m));
    // 关键字
    result = result.replace(/\b([a-zA-Z_]\w*)\b/g, (m) => {
      if (KEYWORDS.has(m)) return chalk.magenta.bold(m);
      if (BUILTINS.has(m)) return chalk.cyan(m);
      return m;
    });
    return result;
  }).join('\n');
}

// ─── Diff 渲染 ──────────────────────────────────────

function renderDiff(code: string): string {
  return code.split('\n').map(line => {
    if (line.startsWith('+++') || line.startsWith('---')) {
      return chalk.bold(line);
    }
    if (line.startsWith('@@')) {
      return chalk.cyan(line);
    }
    if (line.startsWith('+')) {
      return chalk.green(line);
    }
    if (line.startsWith('-')) {
      return chalk.red(line);
    }
    return chalk.dim(line);
  }).join('\n');
}

// ─── OSC 8 终端超链接 ──────────────────────────────────

function oscLink(url: string, text: string): string {
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}

// ─── 主渲染函数 ──────────────────────────────────────

export function renderMarkdown(text: string): string {
  if (!text) return '';

  let output = text;

  // 0. 简易 LaTeX Math 替换处理 (防止 $\rightarrow$ 原样输出)
  output = output.replace(/\$([^\$]+)\$/g, (match, formula) => {
    let tf = formula;
    tf = tf.replace(/\\rightarrow/g, '→');
    tf = tf.replace(/\\leftarrow/g, '←');
    tf = tf.replace(/\\Rightarrow/g, '⇒');
    tf = tf.replace(/\\Leftarrow/g, '⇐');
    tf = tf.replace(/\\leftrightarrow/g, '↔');
    return chalk.italic.cyanBright(tf);
  });

  // 1. 代码块 ```lang...``` （最高优先级，防止内部被其他正则破坏）
  output = output.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const langLabel = lang || 'code';
    const header = chalk.bgGray.white(` ${langLabel} `);

    let body: string;
    if (langLabel === 'diff') {
      body = renderDiff(code.trimEnd());
    } else {
      body = highlightCode(code.trimEnd(), langLabel);
    }
    return `\n${header}\n${body}\n`;
  });

  // 2. 表格（检测包含 | 的行序列）
  output = output.replace(/^(\|.+\|)\n(\|[-:\s|]+\|)\n((?:\|.+\|\n?)+)/gm, (match) => {
    const lines = match.trim().split('\n');
    if (lines.length < 3) return match;

    // 计算列宽
    const rows = lines.filter((_, i) => i !== 1).map(line =>
      line.split('|').filter(Boolean).map(cell => cell.trim())
    );
    const colWidths: number[] = [];
    for (const row of rows) {
      row.forEach((cell, i) => {
        colWidths[i] = Math.max(colWidths[i] || 0, cell.length);
      });
    }

    // 渲染
    const rendered: string[] = [];
    rows.forEach((row, rowIdx) => {
      const cells = row.map((cell, colIdx) => {
        const padded = cell.padEnd(colWidths[colIdx] || 0);
        return rowIdx === 0 ? chalk.bold(padded) : padded;
      });
      rendered.push(`│ ${cells.join(' │ ')} │`);
      if (rowIdx === 0) {
        const sep = colWidths.map(w => '─'.repeat(w)).join('─┼─');
        rendered.push(`├─${sep}─┤`);
      }
    });
    return rendered.join('\n');
  });

  // 3. Inline Code `code`
  output = output.replace(/`([^`]+)`/g, (_, code) => {
    return chalk.bold.white(code);
  });

  // 4. Bold **text**
  output = output.replace(/\*\*([^*]+)\*\*/g, (_, boldText) => {
    return chalk.bold(boldText);
  });

  // 5. Italic *text*
  output = output.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, italicText) => {
    return chalk.italic(italicText);
  });

  // 6. Strikethrough ~~text~~
  output = output.replace(/~~([^~]+)~~/g, (_, text) => {
    return chalk.strikethrough.dim(text);
  });

  // 7. Quotes > text
  output = output.replace(/^>\s+(.+)$/gm, (_, quote) => {
    return chalk.dim(`│ `) + chalk.italic(quote);
  });

  // 8. Headers # Header
  output = output.replace(/^[ \t]*(#{1,6})\s+(.+)$/gm, (_, hashes, title) => {
    const level = hashes.length;
    if (level === 1) return chalk.bold.underline.white(title);
    if (level === 2) return chalk.bold.white(title);
    return chalk.bold(title);
  });

  // 9. 有序列表 (1. Item)
  output = output.replace(/^(\s*)(\d+)\.\s+(.+)$/gm, (_, indent, num, content) => {
    return `${indent}${chalk.dim(`${num}.`)} ${content}`;
  });

  // 10. 无序列表 (- Item / * Item)
  output = output.replace(/^(\s*)[-*]\s+(.+)$/gm, (_, indent, content) => {
    return `${indent}${chalk.dim('•')} ${content}`;
  });

  // 11. 链接 [text](url) → OSC 8
  output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
    return chalk.underline.cyan(oscLink(url, text));
  });

  // 12. 水平线 ---
  output = output.replace(/^---+$/gm, () => {
    const cols = process.stdout.columns || 80;
    return chalk.dim('─'.repeat(Math.min(cols - 4, 60)));
  });

  return output;
}
