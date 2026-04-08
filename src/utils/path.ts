/**
 * 路径工具函数 — 共享路径处理逻辑
 * P2-1: 消除 Welcome.tsx / StatusBar.tsx 中的重复 shortenPath/shortenCwd
 */

/**
 * 缩短路径显示：将 HOME 前缀替换为 ~
 */
export function shortenPath(p: string): string {
  const home = process.env['HOME'] ?? '';
  if (home && p.startsWith(home)) {
    return '~' + p.slice(home.length);
  }
  return p;
}

/**
 * 格式化 Token 数量为可读字符串
 */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 100_000) return (n / 1000).toFixed(1) + 'k';
  return Math.round(n / 1000) + 'k';
}

/**
 * 计算字符串在终端中的显示宽度（CJK / Emoji / 全角占 2 列）
 */
export function displayWidth(str: string): number {
  // 去除 ANSI 转义码
  const clean = str.replace(/\x1B\[[\d;]*m/g, '');
  let width = 0;
  for (const char of clean) {
    const code = char.codePointAt(0) ?? 0;
    if (
      (code >= 0x2E80 && code <= 0x9FFF) ||
      (code >= 0xF900 && code <= 0xFAFF) ||
      (code >= 0xFE30 && code <= 0xFE4F) ||
      (code >= 0xFF01 && code <= 0xFF60) ||
      (code >= 0xFFE0 && code <= 0xFFE6) ||
      (code >= 0x20000 && code <= 0x2FA1F) ||
      (code >= 0x1F300 && code <= 0x1F9FF)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/**
 * 将文本填充空格到终端全宽（用于全宽背景条）
 */
export function padToTermWidth(text: string, termWidth?: number): string {
  const cols = termWidth ?? process.stdout.columns ?? 80;
  const w = displayWidth(text);
  return text + ' '.repeat(Math.max(0, cols - w));
}
