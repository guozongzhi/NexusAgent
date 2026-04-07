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
