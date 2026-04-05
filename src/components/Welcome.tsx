/**
 * Welcome — ASCII Art 欢迎动画
 * 参考 Claude Code 的 WelcomeV2/LogoV2 组件
 * 实现逐帧渐显的品牌标识 + 版本/环境信息
 */
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

// ─── ASCII Art Logo ──────────────────────────────────────
const NEXUS_LOGO = [
  '  ███╗   ██╗███████╗██╗  ██╗██╗   ██╗███████╗',
  '  ████╗  ██║██╔════╝╚██╗██╔╝██║   ██║██╔════╝',
  '  ██╔██╗ ██║█████╗   ╚███╔╝ ██║   ██║███████╗',
  '  ██║╚██╗██║██╔══╝   ██╔██╗ ██║   ██║╚════██║',
  '  ██║ ╚████║███████╗██╔╝ ██╗╚██████╔╝███████║',
  '  ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝',
];

// 紧凑版 Logo（终端宽度不足时使用）
const NEXUS_LOGO_COMPACT = [
  '  ╔╗╔╔═╗═╗╔╦╗╔═╗',
  '  ║║║║╣ ╔╩╗║ ║╚═╗',
  '  ╝╚╝╚═╝╚═╝╚═╝╚═╝',
];

// ─── 随机启动动词 ──────────────────────────────────────
const WELCOME_VERBS = [
  'Initializing workspace',
  'Scanning environment',
  'Loading tools',
  'Preparing session',
  'Activating agent',
];

interface WelcomeProps {
  version?: string;
  model?: string;
  cwd?: string;
  compact?: boolean;
}

export function Welcome({ version = '0.1.0', model, cwd, compact }: WelcomeProps): React.ReactNode {
  const [visibleLines, setVisibleLines] = useState(0);
  const [showInfo, setShowInfo] = useState(false);
  const [bootVerb] = useState(() => WELCOME_VERBS[Math.floor(Math.random() * WELCOME_VERBS.length)]);
  const [showDots, setShowDots] = useState(0);

  const logo = compact ? NEXUS_LOGO_COMPACT : NEXUS_LOGO;
  const totalLines = logo.length;

  // 逐行渐显动画
  useEffect(() => {
    if (visibleLines < totalLines) {
      const timer = setTimeout(() => {
        setVisibleLines((v) => v + 1);
      }, 60);
      return () => clearTimeout(timer);
    } else {
      // Logo 显示完毕后展示信息行
      const timer = setTimeout(() => setShowInfo(true), 150);
      return () => clearTimeout(timer);
    }
  }, [visibleLines, totalLines]);

  // 加载圆点动画
  useEffect(() => {
    if (!showInfo) return;
    const timer = setInterval(() => {
      setShowDots((d) => (d + 1) % 4);
    }, 250);
    return () => clearInterval(timer);
  }, [showInfo]);

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* ASCII Art Logo — 逐行渐显 */}
      <Box flexDirection="column">
        {logo.slice(0, visibleLines).map((line, i) => (
          <Text key={i} color={i < 2 ? 'cyanBright' : i < 4 ? 'cyan' : 'blueBright'}>
            {line}
          </Text>
        ))}
      </Box>

      {/* 信息行 */}
      {showInfo && (
        <Box flexDirection="column" marginTop={1}>
          {/* 版本 + 模型 + 目录 */}
          <Box gap={1}>
            <Text color="gray">v{version}</Text>
            {model && (
              <>
                <Text color="gray">·</Text>
                <Text color="yellowBright">{model}</Text>
              </>
            )}
            {cwd && (
              <>
                <Text color="gray">·</Text>
                <Text color="gray">{shortenPath(cwd)}</Text>
              </>
            )}
          </Box>

          {/* 启动动词动画 */}
          <Box marginTop={1}>
            <Text color="cyan">
              {'◆ '}{bootVerb}{'.'.repeat(showDots).padEnd(3)}
            </Text>
          </Box>

          {/* 安全提示 */}
          <Box marginTop={1}>
            <Text dimColor>
              ⚠ AI 生成的代码可能存在错误，请务必审查后再执行。
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

/** 缩短路径显示（保留最后 2 级） */
function shortenPath(p: string): string {
  const parts = p.split('/').filter(Boolean);
  if (parts.length <= 2) return p;
  return '~/' + parts.slice(-2).join('/');
}
