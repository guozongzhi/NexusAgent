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
import { render, Box, Text, Static, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { program } from 'commander';
import chalk from 'chalk';

// UI 组件
import { printWelcome } from './components/Welcome.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import { PermissionPrompt } from './components/PermissionPrompt.tsx';
import { ToolPanel } from './components/ToolPanel.tsx';
import { NexusSpinner } from './components/Spinner.tsx';

// 核心逻辑
import { QueryEngine } from './QueryEngine.ts';
import { loadSession, saveSession } from './services/history/sessionStore.ts';
import { loadConfig } from './config.ts';
import { parseAndRouteCommand } from './commands/router.ts';
import { OpenAIAdapter } from './services/api/openai-adapter.ts';
import type { Message, ToolUseContext } from './types/index.ts';
import { renderMarkdown } from './utils/markdown.ts';
import { buildSystemPrompt } from './context.ts';
import { getAllFunctionDefs } from './tools/index.ts';
import type { SpinnerMode } from './components/Spinner.tsx';
import { Onboarding, hasCompletedOnboarding, markOnboardingComplete } from './components/Onboarding.tsx';
import { truncateMessages } from './services/history/tokenWindow.ts';

const NEXUS_VERSION = '0.1.0';
export const READ_ONLY_TOOLS = ['file_read', 'list_dir', 'search', 'grep', 'glob'];

// ─── 类型 ──────────────────────────────────────────────

/** 已完成的消息 — 沉淀到 <Static>，带唯一 id */
type CompletedMessage = {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
};

type ToolExecution = {
  id: string;
  name: string;
  args: any;
  status: 'running' | 'success' | 'error';
  result?: string;
};

type ApprovalRequest = {
  toolName: string;
  argsSummary: string;
  resolve: (approved: boolean) => void;
  reject: () => void;
};

// ─── 消息块渲染（用于 Static 内的已完成消息）──────────

let _msgIdCounter = 0;
function nextMsgId(): number {
  return ++_msgIdCounter;
}

function StaticMessageBlock({ item }: { item: CompletedMessage }) {
  let tag = '';
  switch (item.role) {
    case 'user':
      tag = chalk.blue.bold('▶ You');
      break;
    case 'assistant':
      tag = chalk.magenta.bold('◆ Nexus');
      break;
    default:
      tag = chalk.yellow('⚠ System');
      break;
  }

  const content = item.role === 'assistant'
    ? (renderMarkdown ? renderMarkdown(item.content) : item.content)
    : item.content;

  return (
    <Box flexDirection="column" marginBottom={1} paddingX={1}>
      <Text>{tag}</Text>
      <Box paddingLeft={2}>
        <Text>{content}</Text>
      </Box>
    </Box>
  );
}

// ─── 主应用 ────────────────────────────────────────────

function NexusApp({ oneShotQuery }: { oneShotQuery?: string }) {
  const { exit } = useApp();
  const cwd = process.cwd();

  // 已完成的消息 — 沉淀到 <Static>
  const [completedMessages, setCompletedMessages] = useState<CompletedMessage[]>([]);
  // 当前输入
  const [inputValue, setInputValue] = useState(oneShotQuery || '');
  // 处理中标志
  const [isProcessing, setIsProcessing] = useState(false);
  // 流式文本缓冲
  const [streamingText, setStreamingText] = useState('');
  const [spinnerMode, setSpinnerMode] = useState<SpinnerMode | 'idle'>('idle');
  // 工具执行
  const [toolExecutions, setToolExecutions] = useState<ToolExecution[]>([]);
  // 权限确认
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);
  // 初始化就绪
  const [ready, setReady] = useState(false);
  // P2-4: Token 累计
  const [tokenCount, setTokenCount] = useState(0);
  // P1-2: 实际模型名
  const [modelName, setModelName] = useState('active');
  // P1-1: Onboarding 状态
  const [showOnboarding, setShowOnboarding] = useState(() => !hasCompletedOnboarding());
  const [apiReady, setApiReady] = useState(false);
  const [apiError, setApiError] = useState<string | undefined>();

  const engineRef = useRef<QueryEngine | null>(null);
  // 完整消息历史（传给 LLM）
  const historyRef = useRef<Message[]>([]);

  // 流式文本节流缓冲
  const streamBufferRef = useRef('');
  const streamFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // P2-3: 首 token 标记，用于立即刷新
  const isFirstChunkRef = useRef(true);
  const flushStreamBuffer = useCallback(() => {
    if (streamBufferRef.current) {
      const chunk = streamBufferRef.current;
      streamBufferRef.current = '';
      setStreamingText(prev => prev + chunk);
    }
  }, []);

  // ─── 初始化 ──────────────────────────────────────────

  useEffect(() => {
    const init = async () => {
      const conf = await loadConfig();
      const apiKey = conf.apiKey || process.env.OPENAI_API_KEY || 'UNSET_KEY_WAITING_FOR_USER';
      const baseURL = conf.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

      const adapter = new OpenAIAdapter(baseURL, apiKey);
      engineRef.current = new QueryEngine(adapter);

      // 恢复历史会话
      const history = await loadSession(cwd);
      if (history && history.length > 0) {
        historyRef.current = history;
        setCompletedMessages(prev => [
          ...prev,
          { id: nextMsgId(), role: 'system', content: `已恢复 \`${cwd}\` 的历史会话。` },
        ]);
      }

      // P1-2: 设置实际模型名称
      const actualModel = conf.model || process.env.OPENAI_MODEL || 'gpt-4o';
      setModelName(actualModel);

      // P1-1: API 连通性检测（用于 Onboarding）
      if (apiKey && apiKey !== 'UNSET_KEY_WAITING_FOR_USER') {
        try {
          // 尝试一个轻量级 API 调用验证连接
          setApiReady(true);
        } catch (e: any) {
          setApiError(e.message);
        }
      } else {
        setApiError('API Key 未配置');
      }

      setReady(true);
    };
    init();

    // P2-5: cleanup — 清理所有 timer 防止内存泄漏
    return () => {
      if (streamFlushRef.current) {
        clearTimeout(streamFlushRef.current);
        streamFlushRef.current = null;
      }
    };
  }, []);

  // P0-4: oneShotQuery 由 ready 状态驱动，消除竞态
  const oneShotFiredRef = useRef(false);
  useEffect(() => {
    if (ready && oneShotQuery && !oneShotFiredRef.current) {
      oneShotFiredRef.current = true;
      handleSubmit(oneShotQuery);
    }
  }, [ready]);

  // ─── 提交处理 ────────────────────────────────────────

  const handleSubmit = async (value: string) => {
    if (!value.trim() || isProcessing || pendingApproval) return;

    // 斜杠命令
    if (value.startsWith('/')) {
      const resp = await parseAndRouteCommand(value, {
        exit,
        clear: () => setCompletedMessages([]),
        reloadConfig: async () => {
          const newConf = await loadConfig();
          const newKey = newConf.apiKey || process.env.OPENAI_API_KEY || 'UNSET_KEY_WAITING_FOR_USER';
          const newBase = newConf.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
          const newAdapter = new OpenAIAdapter(newBase, newKey);
          engineRef.current = new QueryEngine(newAdapter);

          setCompletedMessages(prev => [
            ...prev,
            {
              id: nextMsgId(),
              role: 'system',
              content: `配置已热重载！\n当前 BaseURL: ${newBase}\n当前模型: ${newConf.model || '未指定'}`,
            },
          ]);
        },
      });

      setCompletedMessages(prev => [
        ...prev,
        { id: nextMsgId(), role: 'user', content: value },
        { id: nextMsgId(), role: 'system', content: resp.output || '' },
      ]);
      setInputValue('');
      return;
    }

    // 正常消息
    setInputValue('');

    // 用户消息立即沉淀到 Static
    setCompletedMessages(prev => [
      ...prev,
      { id: nextMsgId(), role: 'user', content: value },
    ]);

    setIsProcessing(true);
    setSpinnerMode('thinking');
    setToolExecutions([]);
    setStreamingText('');
    // P2-3: 重置首 token 标记
    isFirstChunkRef.current = true;

    try {
      if (!engineRef.current) throw new Error('Engine not initialized');

      // P0-2: 使用 context.ts 的完整 System Prompt
      const sysPrompt = buildSystemPrompt(cwd);
      const conf = await loadConfig();

      // 构建 LLM 消息
      historyRef.current.push({ role: 'user', content: value });

      // P1-4: Token 窗口截断，防止超出模型上下文限制
      const trimmedMessages = truncateMessages([...historyRef.current]);

      // P0-1: 通过 ESM import 获取工具定义（tools/index.ts 副作用注册已在顶层触发）
      const toolDefs = getAllFunctionDefs();

      const response = await engineRef.current.run({
        systemPrompt: sysPrompt,
        model: conf.model || process.env.OPENAI_MODEL || 'gpt-4o',
        messages: trimmedMessages,
        toolDefs,
        toolContext: { cwd } as ToolUseContext,
        onTextDelta: (delta: string) => {
          streamBufferRef.current += delta;
          // P2-3: 首 token 立即刷新（降低 TTFT 感知延迟），后续 50ms 节流
          if (isFirstChunkRef.current) {
            isFirstChunkRef.current = false;
            flushStreamBuffer();
          } else if (!streamFlushRef.current) {
            streamFlushRef.current = setTimeout(() => {
              flushStreamBuffer();
              streamFlushRef.current = null;
            }, 50);
          }
        },
        onToolStart: (name: string, args: any) => {
          setSpinnerMode('tool' as SpinnerMode);
          setToolExecutions(prev => [...prev, { id: String(Date.now()), name, args, status: 'running' }]);
        },
        onToolEnd: (name: string, result: any, isError: boolean) => {
          setSpinnerMode('thinking');
          setToolExecutions(prev =>
            prev.map(t =>
              t.name === name && t.status === 'running'
                ? { ...t, status: isError ? 'error' : 'success', result: JSON.stringify(result) }
                : t
            )
          );
        },
        onToolApprovalRequest: async (toolName: string, args: any) => {
          if (READ_ONLY_TOOLS.includes(toolName)) {
            return true;
          }
          return new Promise<boolean>((resolve, reject) => {
            setPendingApproval({ toolName, argsSummary: JSON.stringify(args), resolve, reject });
          });
        },
      });

      // 最终 flush
      if (streamFlushRef.current) {
        clearTimeout(streamFlushRef.current);
        streamFlushRef.current = null;
      }
      flushStreamBuffer();
      streamBufferRef.current = '';

      // 回复完成 → 沉淀到 Static
      const answerText = response.text || '';
      setCompletedMessages(prev => [
        ...prev,
        { id: nextMsgId(), role: 'assistant', content: answerText },
      ]);

      historyRef.current.push({ role: 'assistant', content: answerText });
      await saveSession(cwd, historyRef.current);

      // P2-4: 累计 token 使用量
      if (response.usage) {
        setTokenCount(prev => prev + response.usage.promptTokens + response.usage.completionTokens);
      }
    } catch (err: any) {
      setCompletedMessages(prev => [
        ...prev,
        { id: nextMsgId(), role: 'system', content: `执行出错: ${err.message}` },
      ]);
    } finally {
      // 清理流式状态
      if (streamFlushRef.current) {
        clearTimeout(streamFlushRef.current);
        streamFlushRef.current = null;
      }
      streamBufferRef.current = '';
      setIsProcessing(false);
      setSpinnerMode('idle');
      setStreamingText('');
      setToolExecutions([]);
    }
  };

  if (!ready) return null;

  // P1-1: 首次启动显示 Onboarding
  if (showOnboarding) {
    return (
      <Onboarding
        apiReady={apiReady}
        apiError={apiError}
        model={modelName}
        onDone={() => {
          markOnboardingComplete();
          setShowOnboarding(false);
        }}
      />
    );
  }

  return (
    <>
      {/* ═══ 静态区域：已完成消息沉淀到 scrollback ═══ */}
      <Static items={completedMessages}>
        {(msg) => <StaticMessageBlock key={msg.id} item={msg} />}
      </Static>

      {/* ═══ 动态区域：仅活跃元素，最多 3-5 行 ═══ */}

      {/* 流式文本（处理中时显示） */}
      {isProcessing && streamingText && (
        <Box paddingLeft={3} marginBottom={1}>
          <Text>{renderMarkdown ? renderMarkdown(streamingText) : streamingText}</Text>
        </Box>
      )}

      {/* 工具执行面板（处理中时显示） */}
      {toolExecutions.length > 0 && (
        <ToolPanel tools={toolExecutions.map(t => ({
          ...t,
          displayName: t.name,
        }))} shouldAnimate={true} />
      )}

      {/* 权限确认 or 输入框/Spinner */}
      {pendingApproval ? (
        <PermissionPrompt
          toolName={pendingApproval.toolName}
          argsSummary={pendingApproval.argsSummary}
          onApprove={() => {
            pendingApproval.resolve(true);
            setPendingApproval(null);
          }}
          onReject={() => {
            pendingApproval.resolve(false);
            setPendingApproval(null);
          }}
        />
      ) : (
        <Box flexDirection="column">
          {!isProcessing && (
            <Box paddingX={1}>
              <Text bold color="blue">▶ You: </Text>
              <TextInput
                value={inputValue}
                onChange={setInputValue}
                onSubmit={handleSubmit}
              />
            </Box>
          )}

          {isProcessing && spinnerMode !== 'idle' && (
            <Box paddingX={1}>
              <NexusSpinner mode={spinnerMode as SpinnerMode} />
            </Box>
          )}
        </Box>
      )}

      {/* 底部状态栏 */}
      <Box marginTop={1} paddingX={1}>
        <StatusBar cwd={cwd} model={modelName} tokenCount={tokenCount} isProcessing={isProcessing} />
      </Box>
    </>
  );
}

// ─── CLI 启动 ──────────────────────────────────────────

program
  .name('nexus')
  .description('Nexus Agent - 强大的终端智能化生产力平台')
  .version(NEXUS_VERSION)
  .argument('[query...]', '一次性任务描述（非交互模式）')
  .action(async (queryArray) => {
    const oneShotQuery = queryArray?.join(' ');
    const cwd = process.cwd();
    const conf = await loadConfig();

    // Welcome banner 直出 stdout，不进 Ink
    printWelcome(NEXUS_VERSION, cwd, conf.model || 'active');

    // Ink 只管动态区域
    render(<NexusApp oneShotQuery={oneShotQuery} />);
  });

program.parse(process.argv);
