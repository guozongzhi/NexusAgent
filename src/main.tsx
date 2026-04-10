#!/usr/bin/env bun
/**
 * Nexus Agent — CLI 入口
 * 渲染架构：Static + 动态分区
 *
 * - Welcome banner: 启动时 console.log 直出，不进 Ink
 * - 已完成消息: <Static> 沉淀到 scrollback，永不重绘
 * - 活跃区域: 仅流式文本 + spinner + 输入框 + 状态栏（3-5行）
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { render, Box, Text, Static, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { program } from 'commander';
import chalk from 'chalk';

// UI 组件
import { printWelcome } from './components/Welcome.tsx';
import { Onboarding, markOnboardingComplete } from './components/Onboarding.tsx';
import { ChatScreen } from './screens/ChatScreen.tsx';

// 钩子与分发
import { loadConfig } from './config.ts';
import { useAgentLoop } from './hooks/useAgentLoop.ts';
import { useInput } from 'ink';

const NEXUS_VERSION = '0.3.0';
export const READ_ONLY_TOOLS = ['file_read', 'list_dir', 'search', 'grep', 'glob', 'note'];

// ─── 主应用 ────────────────────────────────────────────

function NexusApp({ oneShotQuery, skipPermissions }: { oneShotQuery?: string; skipPermissions?: boolean }) {
  const cwd = process.cwd();
  
  // 使用重构后的 Agent Loop (管理所有的状态、LLM 对话历史和工具分发)
  const agentState = useAgentLoop({ oneShotQuery, skipPermissions, cwd });
  
  // 热键监控 (全局拦截)
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      agentState.interrupt();
    }
  });

  if (!agentState.ready) return null;

  // 新手引导
  if (agentState.showOnboarding) {
    return (
      <Onboarding
        apiReady={agentState.apiReady}
        apiError={agentState.apiError}
        model={agentState.modelName}
        onDone={() => {
          markOnboardingComplete();
          agentState.setShowOnboarding(false);
        }}
      />
    );
  }

  // 对话主视图
  return (
    <ChatScreen
      cwd={cwd}
      modelName={agentState.modelName}
      completedMessages={agentState.completedMessages}
      inputValue={agentState.inputValue}
      setInputValue={agentState.setInputValue}
      isProcessing={agentState.isProcessing}
      streamingText={agentState.streamingText}
      spinnerMode={agentState.spinnerMode}
      toolExecutions={agentState.toolExecutions}
      pendingApproval={agentState.pendingApproval}
      setPendingApproval={agentState.setPendingApproval}
      tokenCount={agentState.tokenCount}
      handleSubmit={agentState.handleSubmit}
    />
  );
}

// ─── CLI 启动 ──────────────────────────────────────────

program
  .name('nexus')
  .description('Nexus Agent - 强大的终端智能化生产力平台')
  .version(NEXUS_VERSION)
  .option('--dangerously-skip-permissions', '跳过所有工具权限确认（用于 CI/CD 或自动化流水线）')
  .argument('[query...]', '一次性任务描述（非交互模式）')
  .action(async (queryArray, opts) => {
    const oneShotQuery = queryArray?.join(' ');
    const skipPermissions = !!opts.dangerouslySkipPermissions;
    const cwd = process.cwd();
    const conf = await loadConfig();

    // Welcome banner 直出 stdout，不进 Ink
    printWelcome(NEXUS_VERSION, cwd, conf.model || 'active');

    if (skipPermissions) {
      console.log(chalk.bgYellow.black(' ⚠ WARNING ') + chalk.yellow(' --dangerously-skip-permissions 已启用，所有工具权限确认将被跳过！'));
    }

    // Ink 只管动态区域，禁用默认的 exitOnCtrlC，由我们自行处理
    render(<NexusApp oneShotQuery={oneShotQuery} skipPermissions={skipPermissions} />, { exitOnCtrlC: false });
  });

program.parse(process.argv);
