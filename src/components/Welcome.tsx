/**
 * Welcome — 启动欢迎输出
 * 蓝色渐变 ASCII Art Logo + 公告信息 + 版本信息
 */
import chalk from 'chalk';
import { shortenPath } from '../utils/path.ts';

// ─── ASCII Art Logo（蓝色渐变）──────────────────────────
const NEXUS_LOGO = [
  '  ███╗   ██╗███████╗██╗  ██╗██╗   ██╗███████╗',
  '  ████╗  ██║██╔════╝╚██╗██╔╝██║   ██║██╔════╝',
  '  ██╔██╗ ██║█████╗   ╚███╔╝ ██║   ██║███████╗',
  '  ██║╚██╗██║██╔══╝   ██╔██╗ ██║   ██║╚════██║',
  '  ██║ ╚████║███████╗██╔╝ ██╗╚██████╔╝███████║',
  '  ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝',
];

/**
 * 纯函数：直接输出到 stdout
 * 在 Ink render() 之前调用，不会被 Ink 管控/清除
 */
export function printWelcome(version: string, cwd: string, model: string): void {
  console.log('');

  // ── Logo — 逐行蓝色渐变上色 ──
  NEXUS_LOGO.forEach((line, i) => {
    const color = i < 2 ? chalk.cyanBright : i < 4 ? chalk.cyan : chalk.blueBright;
    console.log(color(line));
  });

  // ── 版本 + 模型 + 目录 ──
  const shortCwd = shortenPath(cwd);
  console.log('');
  console.log(
    `  ${chalk.gray(`v${version}`)} ${chalk.gray('·')} ${chalk.white(model)} ${chalk.gray('·')} ${chalk.gray(shortCwd)}`
  );

  // ── 公告信息（无背景，dim 灰色文字） ──
  console.log('');
  console.log(chalk.dim(`  ↑ 输入 /help 查看所有可用命令`));
  console.log('');
  console.log(chalk.dim(`  ⚠ AI 生成的代码可能存在错误，请务必审查后再执行。`));
  console.log('');
}
