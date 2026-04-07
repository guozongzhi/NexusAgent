/**
 * Welcome — Claude Code 风格欢迎界面
 * 修复：中文字符宽度计算（CJK 占 2 列），logo 优化
 */
import chalk from 'chalk';
import { shortenPath } from '../utils/path.ts';

// ─── 像素风 Agent 图标 ──────────────────────────────────
const AGENT_ICON = [
  '  ┌─────┐',
  '  │ ◈ ◈ │',
  '  │  ▽  │',
  '  └──┬──┘',
  '   ╔═╧═╗',
  '   ║ N ║',
  '   ╚═══╝',
];

/**
 * 计算字符串在终端中的实际显示宽度
 * CJK / Emoji / 全角字符占 2 列
 */
function displayWidth(str: string): number {
  // 先去除 ANSI 转义码
  const clean = str.replace(/\x1B\[[\d;]*m/g, '');
  let width = 0;
  for (const char of clean) {
    const code = char.codePointAt(0) ?? 0;
    // CJK Unified Ideographs / CJK Symbols / Fullwidth Forms / Common CJK ranges
    if (
      (code >= 0x2E80 && code <= 0x9FFF) ||   // CJK 基本
      (code >= 0xF900 && code <= 0xFAFF) ||   // CJK 兼容
      (code >= 0xFE30 && code <= 0xFE4F) ||   // CJK 兼容形式
      (code >= 0xFF01 && code <= 0xFF60) ||   // 全角 ASCII
      (code >= 0xFFE0 && code <= 0xFFE6) ||   // 全角符号
      (code >= 0x20000 && code <= 0x2FA1F) || // CJK 扩展
      (code >= 0x1F300 && code <= 0x1F9FF)    // Emoji
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/**
 * 将字符串填充到指定显示宽度（考虑 CJK 宽度）
 */
function padEnd(str: string, targetWidth: number): string {
  const currentWidth = displayWidth(str);
  const padding = Math.max(0, targetWidth - currentWidth);
  return str + ' '.repeat(padding);
}

/**
 * 纯函数：直接输出到 stdout
 * 在 Ink render() 之前调用，不会被 Ink 管控/清除
 */
export function printWelcome(version: string, cwd: string, model: string): void {
  const termWidth = process.stdout.columns || 80;
  const boxInner = Math.min(termWidth - 2, 72); // 内容区宽度（不含左右边框）
  const leftCol = 20;  // 左栏宽度
  const sep = 1;       // 分隔符宽度
  const rightCol = boxInner - leftCol - sep; // 右栏宽度

  // ── 顶部边框 ──
  const titleText = ` Nexus Agent v${version} `;
  const titleLen = titleText.length;
  const topRight = '─'.repeat(Math.max(0, boxInner - titleLen - 1));
  console.log(chalk.gray('╭─') + chalk.red(titleText) + chalk.gray(topRight + '╮'));

  // ── 构建左右栏内容 ──
  const leftLines = [
    '',
    chalk.bold('  Welcome back!'),
    '',
    ...AGENT_ICON,
  ];

  const rightLines = [
    chalk.yellowBright.bold('Tips for getting started'),
    `输入 ${chalk.cyan('/help')} 查看所有可用命令`,
    '',
    chalk.yellowBright.bold('Recent activity'),
    chalk.gray('No recent activity'),
  ];

  // ── 双栏输出 ──
  const maxLines = Math.max(leftLines.length, rightLines.length);
  for (let i = 0; i < maxLines; i++) {
    const left = padEnd(leftLines[i] ?? '', leftCol);
    const right = padEnd(rightLines[i] ?? '', rightCol);
    console.log(chalk.gray('│') + left + chalk.gray('│') + right + chalk.gray('│'));
  }

  // ── 模型 + 路径行 ──
  const shortCwd = shortenPath(cwd);
  const infoText = `  ${chalk.yellowBright(model)} ${chalk.gray('·')} ${chalk.gray(shortCwd)}`;
  const infoPadded = padEnd(infoText, boxInner);
  console.log(chalk.gray('│') + infoPadded + chalk.gray('│'));

  // ── 底部边框 ──
  console.log(chalk.gray('╰' + '─'.repeat(boxInner) + '╯'));

  // ── 公告 ──
  console.log('');
  console.log(`  ${chalk.dim('⚠  AI 生成的代码可能存在错误，请务必审查后再执行。')}`);
  console.log('');
}
