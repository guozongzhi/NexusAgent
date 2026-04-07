/**
 * Welcome — ASCII Art 欢迎区块
 *
 * 两种输出方式：
 * 1. printWelcome() — 纯 stdout 直出，启动时一次性调用，不进 Ink
 * 2. <WelcomeStatic> — 用于 <Static> 中的静态渲染（无动画/无定时器）
 */
import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { shortenPath } from '../utils/path.ts';

// ─── ASCII Art Logo ──────────────────────────────────────
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

  // Logo — 逐行上色
  NEXUS_LOGO.forEach((line, i) => {
    const color = i < 2 ? chalk.cyanBright : i < 4 ? chalk.cyan : chalk.blueBright;
    console.log(color(line));
  });

  // 版本 + 模型 + 目录
  const shortCwd = shortenPath(cwd);
  console.log('');
  console.log(
    `  ${chalk.gray(`v${version}`)} ${chalk.gray('·')} ${chalk.yellowBright(model)} ${chalk.gray('·')} ${chalk.gray(shortCwd)}`
  );

  // 启动提示
  console.log('');
  console.log(`  ${chalk.cyan('◆ Activating agent...')}`);
  console.log('');
  console.log(`  ${chalk.dim('⚠ AI 生成的代码可能存在错误，请务必审查后再执行。')}`);
  console.log('');
}

// P2-1: shortenPath 已提取到 utils/path.ts
