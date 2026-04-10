/**
 * Welcome — 启动欢迎输出
 * Claude Code 风格：紧凑结构化卡片 + 关键信息
 */
import chalk from 'chalk';
import { shortenPath } from '../utils/path.ts';

// ─── 压缩版 Logo (相对缩小的彩蓝色核心) ──────────────────
const NEXUS_LOGO_COMPACT = [
  '╔╗╔╔═╗═╗╔╦╗╔═╗', // 真实可视宽度 14
  '║║║║╣ ╔╩╗║ ║╚═╗', // 真实可视宽度 15
  '╝╚╝╚═╝╚═╝╚═╝╚═╝', // 真实可视宽度 15
];

// ─── 边框字符（圆角）───────────────────────────────────
const BOX = { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' };

function stripAnsi(str: string): string {
  return str.replace(/\u001b\[[0-9;]*m/g, '');
}

/** 
 * 生成带内边距的边框内容行（明黄边框）
 */
function boxLine(content: string, totalWidth: number, paddingX: number = 2): string {
  const visibleLen = stripAnsi(content).length;
  const maxContentWidth = totalWidth - 2 - paddingX * 2;
  const pad = Math.max(0, maxContentWidth - visibleLen);
  const leftPad = ' '.repeat(paddingX);
  const rightPad = ' '.repeat(pad + paddingX);
  return `  ${chalk.dim(BOX.v)}${leftPad}${content}${rightPad}${chalk.dim(BOX.v)}`;
}

/**
 * 纯函数：直接输出到 stdout
 * 在 Ink render() 之前调用，不会被 Ink 管控/清除
 */
export function printWelcome(version: string, cwd: string, model: string): void {
  const shortCwd = shortenPath(cwd);
  
  console.log('');
  
  // ── 1. 左侧 Logo 与右侧文本完美左对齐 ──
  const rightLines = [
    `${chalk.bold.whiteBright('Nexus Agent')} ${chalk.dim(`v${version}`)}`,
    `${chalk.dim('Model:      ')} ${chalk.whiteBright(model)}`,
    `${chalk.dim('Workspace:  ')} ${chalk.gray(shortCwd)}`,
  ];

  for (let i = 0; i < 3; i++) {
    const rawLogo = NEXUS_LOGO_COMPACT[i] || '';
    const logoColor = i === 0 ? chalk.cyanBright.bold : i === 1 ? chalk.cyan.bold : chalk.blueBright.bold;
    const logoPart = logoColor(rawLogo);
    const rightPart = rightLines[i] || '';
    
    // 强制右侧起始列对齐到 18 (由于最长 logo 行为 15 字符，3空格间距 = 18)
    const padLen = 18 - rawLogo.length;
    const padding = ' '.repeat(Math.max(1, padLen));
    
    console.log(`  ${logoPart}${padding}${rightPart}`);
  }

  console.log('');

  // ── 2. 清新提示区（带柔和黄框） ──
  const terminalWidth = process.stdout.columns || 80;
  const boxTotalWidth = Math.max(Math.min(terminalWidth - 4, 140), 60);
  const boxInnerWidth = boxTotalWidth - 2; 

  console.log(`  ${chalk.dim(BOX.tl)}${chalk.dim(BOX.h.repeat(boxInnerWidth))}${chalk.dim(BOX.tr)}`);
  console.log(boxLine('', boxTotalWidth));
  console.log(boxLine(`${chalk.cyanBright('ℹ')}  ${chalk.yellowBright('Agent Tips')}`, boxTotalWidth, 2));
  console.log(boxLine(`${chalk.dim('•')} Type ${chalk.cyan('/help')} ${chalk.dim('to see available commands.')}`, boxTotalWidth, 2));
  console.log(boxLine(`${chalk.dim('•')} Type ${chalk.cyan('/memory')} ${chalk.dim('to save preferences for future sessions.')}`, boxTotalWidth, 2));
  console.log(boxLine('', boxTotalWidth));
  console.log(`  ${chalk.dim(BOX.bl)}${chalk.dim(BOX.h.repeat(boxInnerWidth))}${chalk.dim(BOX.br)}`);
  
  console.log('');
}
