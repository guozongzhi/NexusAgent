/**
 * Welcome — Claude Code 风格欢迎界面
 *
 * 布局：
 * ╭─ Nexus Agent v0.1.0 ──────────────────────────────╮
 * │                    │  Tips for getting started      │
 * │  Welcome back!     │  输入 /help 查看所有可用命令    │
 * │                    │                                │
 * │   ◆ ◆              │  Recent activity               │
 * │                    │  No recent activity             │
 * │  model · path      │                                │
 * ╰────────────────────────────────────────────────────╯
 */
import chalk from 'chalk';
import { shortenPath } from '../utils/path.ts';

// ─── 简约 Agent 图标 ──────────────────────────────────
const AGENT_ICON = [
  '    ╭───╮   ',
  '    │ ◆ │   ',
  '  ╭─┴───┴─╮ ',
  '  │ NEXUS │ ',
  '  ╰───────╯ ',
];

/**
 * 纯函数：直接输出到 stdout
 * 在 Ink render() 之前调用，不会被 Ink 管控/清除
 */
export function printWelcome(version: string, cwd: string, model: string): void {
  const termWidth = process.stdout.columns || 80;
  const boxWidth = Math.min(termWidth - 2, 76);
  const leftColWidth = 22;
  const rightColWidth = boxWidth - leftColWidth - 3; // 3 for border + separator

  // 顶部边框
  const topLine = `╭─ ${chalk.red(`Nexus Agent v${version}`)} ${'─'.repeat(Math.max(0, boxWidth - version.length - 19))}╮`;
  console.log(chalk.gray(topLine));

  // 构建右侧文本行
  const rightLines = [
    chalk.yellowBright.bold('Tips for getting started'),
    `输入 ${chalk.cyan('/help')} 查看所有可用命令`,
    '',
    chalk.yellowBright.bold('Recent activity'),
    chalk.gray('No recent activity'),
    '',
  ];

  // 构建左侧文本行（图标 + 信息）
  const shortCwd = shortenPath(cwd);
  const leftLines = [
    '',
    chalk.bold('  Welcome back!'),
    '',
    ...AGENT_ICON.slice(0, 2),
    '',
  ];

  // 输出双栏
  const maxLines = Math.max(leftLines.length, rightLines.length);
  for (let i = 0; i < maxLines; i++) {
    const left = stripAnsi(leftLines[i] ?? '');
    const right = rightLines[i] ?? '';
    const leftPad = (leftLines[i] ?? '') + ' '.repeat(Math.max(0, leftColWidth - left.length));
    const rightRaw = stripAnsi(right);
    const rightPad = right + ' '.repeat(Math.max(0, rightColWidth - rightRaw.length));
    console.log(chalk.gray('│') + leftPad + chalk.gray('│') + ' ' + rightPad + chalk.gray('│'));
  }

  // 模型 + 路径行
  const infoLine = `  ${chalk.yellowBright(model)} ${chalk.gray('·')} ${chalk.gray(shortCwd)}`;
  const infoRaw = stripAnsi(infoLine);
  const infoPad = infoLine + ' '.repeat(Math.max(0, boxWidth - infoRaw.length));
  console.log(chalk.gray('│') + infoPad + chalk.gray('│'));

  // 底部边框
  console.log(chalk.gray(`╰${'─'.repeat(boxWidth)}╯`));

  // 公告行
  console.log('');
  console.log(`  ${chalk.dim('⚠  AI 生成的代码可能存在错误，请务必审查后再执行。')}`);
  console.log('');
}

/** 去除 ANSI 转义码，用于计算实际显示宽度 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[\d+m|\x1B\[[\d;]+m/g, '');
}
