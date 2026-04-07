/**
 * NexusSpinner — 多状态 Spinner 组件
 * 参考 Claude Code 的 Spinner/ToolUseLoader 组件
 * 供工具执行、思考、等待权限等场景使用
 */
import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';

// ─── 帧序列 ──────────────────────────────────────────────
const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const DOT_FRAMES = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'];

// ─── Spinner 动词 ────────────────────────────────────────
const SPINNER_VERBS = [
  'Thinking',
  'Analyzing',
  'Reasoning',
  'Processing',
  'Considering',
  'Evaluating',
  'Working',
  'Computing',
];

// ─── 类型 ────────────────────────────────────────────────
export type SpinnerMode = 'thinking' | 'tool' | 'streaming' | 'waiting';

interface NexusSpinnerProps {
  /** 当前模式 */
  mode: SpinnerMode;
  /** 自定义显示文本（覆盖随机动词） */
  label?: string;
  /** 是否有活跃的工具调用 */
  hasActiveTools?: boolean;
}

export function NexusSpinner({ mode, label, hasActiveTools }: NexusSpinnerProps): React.ReactNode {
  // 单一 tick 驱动所有动画，减少 setState 调用次数
  const [tick, setTick] = useState(0);
  const startRef = useRef(Date.now());
  const [randomVerb] = useState(() => SPINNER_VERBS[Math.floor(Math.random() * SPINNER_VERBS.length)] ?? 'Thinking');

  // 单一定时器，120ms 间隔（比 80ms 更温和，仍足够流畅）
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 120);
    return () => clearInterval(timer);
  }, []);

  // 重置计时器
  useEffect(() => {
    startRef.current = Date.now();
  }, [mode]);

  // 从 tick 派生所有值，不额外 setState
  const frame = tick % BRAILLE_FRAMES.length;
  const dotFrame = tick % DOT_FRAMES.length;
  const elapsedMs = Date.now() - startRef.current;

  const verb = label ?? getVerbForMode(mode, randomVerb);
  const elapsed = formatElapsed(elapsedMs);
  const color: string = getColorForMode(mode, elapsedMs);

  const isStalled = mode === 'thinking' && elapsedMs > 10000;

  return (
    <Box flexDirection="row" flexWrap="wrap" marginTop={1} width="100%">
      <Text color={color}>
        {isStalled ? DOT_FRAMES[dotFrame] : BRAILLE_FRAMES[frame]}{' '}
      </Text>
      <Text color={color} bold>
        {verb}…
      </Text>
      {elapsedMs > 2000 && (
        <Text color="gray"> ({elapsed})</Text>
      )}
      {hasActiveTools && (
        <Text color="gray"> · tools active</Text>
      )}
    </Box>
  );
}

// ─── 仅导出 dot 状态指示器（用在工具面板行首）──────────
const BLACK_CIRCLE = '⬤';

interface ToolDotProps {
  isResolved: boolean;
  isError: boolean;
  shouldAnimate: boolean;
}

export function ToolDot({ isResolved, isError, shouldAnimate }: ToolDotProps): React.ReactNode {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!shouldAnimate || isResolved || isError) return;
    const timer = setInterval(() => setVisible((v) => !v), 400);
    return () => clearInterval(timer);
  }, [shouldAnimate, isResolved, isError]);

  const color = isError ? 'red' : isResolved ? 'green' : undefined;
  const dimColor = !isResolved && !isError;

  return (
    <Box minWidth={2}>
      <Text color={color} dimColor={dimColor}>
        {!shouldAnimate || visible || isError || isResolved ? BLACK_CIRCLE : ' '}
      </Text>
    </Box>
  );
}

// ─── 辅助函数 ────────────────────────────────────────────
function getVerbForMode(mode: SpinnerMode, fallback: string): string {
  switch (mode) {
    case 'thinking': return fallback;
    case 'tool': return 'Executing';
    case 'streaming': return 'Writing';
    case 'waiting': return 'Waiting for permission';
    default: return fallback;
  }
}

function getColorForMode(mode: SpinnerMode, elapsedMs: number): string {
  if (mode === 'thinking' && elapsedMs > 10000) return 'red';
  switch (mode) {
    case 'thinking': return 'cyan';
    case 'tool': return 'yellow';
    case 'streaming': return 'green';
    case 'waiting': return 'magenta';
    default: return 'cyan';
  }
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainderSec = seconds % 60;
  return `${minutes}m${remainderSec}s`;
}
