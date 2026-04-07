/**
 * Onboarding — 首次启动引导流程
 * 参考 Claude Code 的 Onboarding.tsx 步骤式状态机
 * 步骤：环境检测 → API 连通性 → 安全提示 → 完成
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// ─── 类型 ────────────────────────────────────────────────
type StepId = 'env-check' | 'api-check' | 'security' | 'done';

interface OnboardingStep {
  id: StepId;
  component: React.ReactNode;
}

interface OnboardingProps {
  /** API 连通性检测 */
  apiReady: boolean;
  apiError?: string;
  model: string;
  onDone: () => void;
}

export function Onboarding({ apiReady, apiError, model, onDone }: OnboardingProps): React.ReactNode {
  const [currentStep, setCurrentStep] = useState(0);

  const goNext = useCallback(() => {
    const steps = buildSteps();
    if (currentStep < steps.length - 1) {
      setCurrentStep((s) => s + 1);
    } else {
      onDone();
    }
  }, [currentStep, onDone]);

  function buildSteps(): OnboardingStep[] {
    const steps: OnboardingStep[] = [];

    // Step 1: 环境检测
    steps.push({
      id: 'env-check',
      component: <EnvCheckStep onContinue={goNext} />,
    });

    // Step 2: API 连通性
    steps.push({
      id: 'api-check',
      component: (
        <ApiCheckStep
          ready={apiReady}
          error={apiError}
          model={model}
          onContinue={goNext}
        />
      ),
    });

    // Step 3: 安全提示
    steps.push({
      id: 'security',
      component: <SecurityStep onContinue={goNext} />,
    });

    return steps;
  }

  const steps = buildSteps();
  const step = steps[currentStep];

  return (
    <Box flexDirection="column" marginTop={1}>
      {step?.component}
    </Box>
  );
}

// ─── 步骤组件 ────────────────────────────────────────────

/** 环境检测步骤 */
function EnvCheckStep({ onContinue }: { onContinue: () => void }): React.ReactNode {
  const [checks, setChecks] = useState<Array<{ label: string; ok: boolean }>>([]);

  useEffect(() => {
    const results: Array<{ label: string; ok: boolean }> = [];

    // 检测运行时
    results.push({ label: 'Bun runtime', ok: 'Bun' in globalThis });

    // 检测工作目录
    results.push({ label: `Working directory: ${process.cwd()}`, ok: true });

    // 检测 Node 版本兼容性
    results.push({ label: `Platform: ${process.platform} ${process.arch}`, ok: true });

    setChecks(results);

    // 自动进入下一步
    const timer = setTimeout(onContinue, 800);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Box flexDirection="column" paddingLeft={1} gap={1}>
      <Text bold>环境检测</Text>
      {checks.map((c, i) => (
        <Text key={i} color={c.ok ? 'green' : 'red'}>
          {c.ok ? '  ✓' : '  ✗'} {c.label}
        </Text>
      ))}
    </Box>
  );
}

/** API 连通性检测步骤 */
function ApiCheckStep({
  ready,
  error,
  model,
  onContinue,
}: {
  ready: boolean;
  error?: string;
  model: string;
  onContinue: () => void;
}): React.ReactNode {
  useEffect(() => {
    if (ready) {
      const timer = setTimeout(onContinue, 600);
      return () => clearTimeout(timer);
    }
  }, [ready]);

  return (
    <Box flexDirection="column" paddingLeft={1} gap={1}>
      <Text bold>API 连接</Text>
      {ready ? (
        <Text color="green">  ✓ 已连接到 {model}</Text>
      ) : error ? (
        <>
          <Text color="red">  ✗ 连接失败</Text>
          <Text color="gray">    {error}</Text>
          <Box marginTop={1}>
            <PressEnterToContinue onPress={onContinue} label="按 Enter 跳过" />
          </Box>
        </>
      ) : (
        <Text color="yellow">  ⏳ 正在连接 {model}...</Text>
      )}
    </Box>
  );
}

/** 安全提示步骤 */
function SecurityStep({ onContinue }: { onContinue: () => void }): React.ReactNode {
  return (
    <Box flexDirection="column" paddingLeft={1} gap={1}>
      <Text bold>安全提示</Text>
      <Box flexDirection="column" width={70}>
        <Text>  1. AI 生成的代码可能存在错误</Text>
        <Text dimColor wrap="wrap">
          {'     '}请始终审查 Agent 的操作，尤其是文件写入和命令执行。
        </Text>
        <Text> </Text>
        <Text>  2. 仅在可信代码库中使用</Text>
        <Text dimColor wrap="wrap">
          {'     '}提示注入风险可能导致意外行为，确保代码来源可靠。
        </Text>
      </Box>
      <Box marginTop={1}>
        <PressEnterToContinue onPress={onContinue} />
      </Box>
    </Box>
  );
}

// ─── 通用：按 Enter 继续 ────────────────────────────────
function PressEnterToContinue({
  onPress,
  label = '按 Enter 继续',
}: {
  onPress: () => void;
  label?: string;
}): React.ReactNode {
  useInput((_, key) => {
    if (key.return) {
      onPress();
    }
  });

  return <Text dimColor>  {label}</Text>;
}

// ─── 首次运行检测工具 ────────────────────────────────────
const ONBOARDING_FLAG_PATH = `${process.env['HOME'] ?? '/tmp'}/.nexus/.onboarded`;

export function hasCompletedOnboarding(): boolean {
  try {
    return existsSync(ONBOARDING_FLAG_PATH);
  } catch {
    return false;
  }
}

export function markOnboardingComplete(): void {
  try {
    const dir = dirname(ONBOARDING_FLAG_PATH);
    mkdirSync(dir, { recursive: true });
    writeFileSync(ONBOARDING_FLAG_PATH, new Date().toISOString());
  } catch {
    // 忽略写入失败
  }
}
