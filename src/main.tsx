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
import { StatusBar } from './components/StatusBar.tsx';
import { PermissionPrompt } from './components/PermissionPrompt.tsx';
import { ToolPanel } from './components/ToolPanel.tsx';
import { NexusSpinner } from './components/Spinner.tsx';

// 核心逻辑
import { QueryEngine } from './QueryEngine.ts';
import { loadSession, saveSession } from './services/history/sessionStore.ts';
import { getCurrentSessionId } from './services/history/sessionStore.ts';
import { loadConfig } from './config.ts';
import { parseAndRouteCommand } from './commands/router.ts';
import { OpenAIAdapter } from './services/api/openai-adapter.ts';
import { createAdapter } from './services/api/adapterFactory.ts';
import type { Message, ToolUseContext, LLMAdapter } from './types/index.ts';
import { renderMarkdown } from './utils/markdown.ts';
import { buildSystemPrompt, buildSystemPromptAsync } from './context.ts';
import { getAllFunctionDefs, getTool } from './tools/index.ts';
import type { SpinnerMode } from './components/Spinner.tsx';
import { Onboarding, hasCompletedOnboarding, markOnboardingComplete } from './components/Onboarding.tsx';
import { truncateMessages } from './services/history/tokenWindow.ts';
import { autoCompactIfNeeded, createAutoCompactState, compactConversation } from './services/compact/index.ts';
import { padToTermWidth } from './utils/path.ts';
import { isToolAutoApproved, addAutoApprovedTool } from './security/permissionStore.ts';
import { mcpManager } from './services/mcp/McpClientManager.ts';

const NEXUS_VERSION = '0.3.0';
export const READ_ONLY_TOOLS = ['file_read', 'list_dir', 'search', 'grep', 'glob', 'note'];

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
  if (item.role === 'user') {
    // 全宽淡灰色背景条 + 白色文字
    const padded = padToTermWidth(' ' + item.content);
    return (
      <Box marginTop={1}>
        <Text backgroundColor="blackBright" color="white">{padded}</Text>
      </Box>
    );
  }

  if (item.role === 'assistant') {
    const content = renderMarkdown ? renderMarkdown(item.content) : item.content;
    // Claude Code 风格：● 圆点前缀 + 文本
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text color="white" bold>{'● '}</Text>
          <Text wrap="wrap">{content}</Text>
        </Box>
      </Box>
    );
  }

  // system
  return (
    <Box marginBottom={1} paddingX={1}>
      <Text dimColor>{item.content}</Text>
    </Box>
  );
}

// ─── 主应用 ────────────────────────────────────────────

function NexusApp({ oneShotQuery, skipPermissions }: { oneShotQuery?: string; skipPermissions?: boolean }) {
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
  // 移除 autoApprovedToolsRef，使用持久化存储

  const engineRef = useRef<QueryEngine | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  // 完整消息历史（传给 LLM）
  const historyRef = useRef<Message[]>([]);
  // AutoCompact 状态
  const autoCompactStateRef = useRef(createAutoCompactState());
  // LLM 适配器引用（compact 需要直接调用）
  const adapterRef = useRef<LLMAdapter | null>(null);

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

  // ─── 热键监听（Ctrl+C 中断/退出） ───────────────────────
  useInput((input, key) => {
    // 处理 Ctrl+C
    if (key.ctrl && input === 'c') {
      if (isProcessing && abortControllerRef.current) {
        // 请求进行中：发送 abort 信号
        setCompletedMessages(prev => [
          ...prev,
          { id: nextMsgId(), role: 'system', content: '[WARNING] 用户已中断当前操作。' }
        ]);
        abortControllerRef.current.abort();
      } else {
        // 没有运行中请求：直接退出应用
        exit();
        process.exit(0);
      }
    }
  });

  // ─── 初始化 ──────────────────────────────────────────

  useEffect(() => {
    const init = async () => {
      const conf = await loadConfig();
      const apiKey = conf.apiKey || process.env.OPENAI_API_KEY || 'UNSET_KEY_WAITING_FOR_USER';
      const baseURL = conf.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

      const adapter = createAdapter(conf);
      adapterRef.current = adapter;
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

      // 连接所有 MCP 外部服务
      if (conf.mcpServers) {
        await mcpManager.connectAll(conf.mcpServers);
      }

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

    // P2-5: cleanup — 清理所有 timer 防止内存泄漏 + 优雅关闭
    const shutdownHandler = () => {
      mcpManager.closeAll().catch(() => {});
    };
    process.on('exit', shutdownHandler);
    process.on('SIGINT', shutdownHandler);
    process.on('SIGTERM', shutdownHandler);

    return () => {
      if (streamFlushRef.current) {
        clearTimeout(streamFlushRef.current);
        streamFlushRef.current = null;
      }
      process.removeListener('exit', shutdownHandler);
      process.removeListener('SIGINT', shutdownHandler);
      process.removeListener('SIGTERM', shutdownHandler);
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
    let query = value;
    if (!query.trim() || isProcessing || pendingApproval) return;

    let resp: any;
    // 斜杠命令
    if (query.startsWith('/')) {
      resp = await parseAndRouteCommand(query, {
        exit,
        clear: () => setCompletedMessages([]),
        reloadConfig: async () => {
          const newConf = await loadConfig();
          const newKey = newConf.apiKey || process.env.OPENAI_API_KEY || 'UNSET_KEY_WAITING_FOR_USER';
          const newBase = newConf.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
          const newAdapter = createAdapter(newConf);
          engineRef.current = new QueryEngine(newAdapter);
          const actualModel = newConf.model || process.env.OPENAI_MODEL || 'gpt-4o';
          setModelName(actualModel);

          // #6: 配置热重载时重连 MCP 服务器
          if (newConf.mcpServers) {
            await mcpManager.closeAll();
            await mcpManager.connectAll(newConf.mcpServers);
          }

          setCompletedMessages(prev => [
            ...prev,
            {
              id: nextMsgId(),
              role: 'system',
              content: `配置已热重载！\n当前 BaseURL: ${newBase}\n当前模型: ${actualModel}`,
            },
          ]);
        },
        getHistory: () => historyRef.current,
        setHistory: (msgs) => { historyRef.current = msgs; },
        getTokenCount: () => tokenCount,
        getModel: () => modelName,
      });

      if (resp.rewrittenQuery) {
        // 如果命令解析器返回了重写后的查询（例如执行技能），则截取原命令到历史，查询转入 LLM
        setCompletedMessages(prev => [
          ...prev,
          { id: nextMsgId(), role: 'user', content: query },
          { id: nextMsgId(), role: 'system', content: `已触发技能，引擎转入自动化工作流。` },
        ]);
        query = resp.rewrittenQuery;
        setInputValue('');
        // Fallthrough 至后续的 LLM 处理...
      } else {
        setCompletedMessages(prev => [
          ...prev,
          { id: nextMsgId(), role: 'user', content: query },
          { id: nextMsgId(), role: 'system', content: resp.output || '' },
        ]);
        setInputValue('');
        return;
      }
    }

    // 正常消息
    if (!resp?.rewrittenQuery && !query.startsWith('/')) {
      setInputValue('');
      setCompletedMessages(prev => [
        ...prev,
        { id: nextMsgId(), role: 'user', content: query },
      ]);
    }

    setIsProcessing(true);
    setSpinnerMode('thinking');
    setToolExecutions([]);
    setStreamingText('');
    isFirstChunkRef.current = true;
    abortControllerRef.current = new AbortController();

    try {
      if (!engineRef.current) throw new Error('Engine not initialized. 请运行 /config set apiKey <your-key> 配置 API Key。');

      // P0-2: 使用 context.ts 的完整 System Prompt（含 NEXUS.md 项目指令）
      let sysPrompt: string;
      try {
        sysPrompt = await buildSystemPromptAsync(cwd);
      } catch (promptErr: any) {
        sysPrompt = buildSystemPrompt(cwd); // 降级为同步版本
        setCompletedMessages(prev => [...prev, { id: nextMsgId(), role: 'system', content: `⚠ System Prompt 构建异常 (${promptErr.message})，已降级处理。` }]);
      }

      let conf;
      try {
        conf = await loadConfig();
      } catch (confErr: any) {
        throw new Error(`配置加载失败: ${confErr.message}。请检查 ~/.nexus/config.json 格式是否正确。`);
      }

      // 构建 LLM 消息
      historyRef.current.push({ role: 'user', content: query });

      // P1-4: 智能上下文压缩（替代简单截断）
      const actualModel = conf.model || process.env.OPENAI_MODEL || 'gpt-4o';
      let workingMessages = [...historyRef.current];

      // AutoCompact: MicroCompact + Full Compact 两层检测
      if (adapterRef.current) {
        const acResult = await autoCompactIfNeeded(
          workingMessages,
          autoCompactStateRef.current,
          {
            adapter: adapterRef.current,
            model: actualModel,
            systemPrompt: sysPrompt,
            onProgress: (status) => {
              setCompletedMessages(prev => [
                ...prev,
                { id: nextMsgId(), role: 'system', content: status },
              ]);
            },
          },
        );
        workingMessages = acResult.messages;
        // 如果发生了 Full Compact，同步更新 historyRef
        if (acResult.compactionResult) {
          historyRef.current = acResult.messages;
        }
      }

      // Fallback: 最终安全截断
      const trimmedMessages = truncateMessages(workingMessages);

      // P0-1: 获取本地内置工具
      const localToolDefs = getAllFunctionDefs();
      const mcpToolsRaw = await mcpManager.getAllTools();
      const mcpToolDefs: import('./types/index.ts').OpenAIFunctionDef[] = mcpToolsRaw.map(t => ({
        type: 'function',
        function: {
          name: `mcp__${t.serverName}__${t.toolName}`,
          description: `[外部 MCP 工具: ${t.serverName}] ${t.description}`,
          parameters: t.inputSchema,
        }
      }));
      const toolDefs = [...localToolDefs, ...mcpToolDefs];

      const response = await engineRef.current.run({
        systemPrompt: sysPrompt,
        model: actualModel,
        messages: trimmedMessages,
        toolDefs,
        toolContext: {
          cwd,
          sessionId: getCurrentSessionId(),
          isAuthorized: skipPermissions ?? false,
        } as ToolUseContext,
        abortSignal: abortControllerRef.current.signal,
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
          // P4-1: 静默模式 — 跳过所有权限确认
          if (skipPermissions) {
            return true;
          }

          const toolInstance = getTool(toolName);
          const isMcp = toolName.startsWith('mcp__');
          const rawAuth = isMcp ? 'requires_confirm' : (toolInstance?.authType || (toolInstance?.isReadOnly ? 'safe' : 'requires_confirm'));
          // 容错处理
          const authType = READ_ONLY_TOOLS.includes(toolName) && !isMcp ? 'safe' : rawAuth;
          
          if (authType === 'safe') {
            return true;
          }
          if (authType !== 'dangerous') {
            const isApproved = await isToolAutoApproved(toolName, cwd);
            if (isApproved) {
              return true;
            }
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
      if (err.name === 'AbortError' || err.message.includes('abort')) {
        // 忽略中止错误
      } else {
        setCompletedMessages(prev => [
          ...prev,
          { id: nextMsgId(), role: 'system', content: `执行出错: ${err.message}` },
        ]);
      }
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
        <Box marginBottom={1}>
          <Text color="white" bold>{'● '}</Text>
          <Text wrap="wrap">{renderMarkdown ? renderMarkdown(streamingText) : streamingText}</Text>
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
          onAlwaysAllow={() => {
            // 异步更新持久化缓存，且默认通过项目级权限
            void addAutoApprovedTool(pendingApproval.toolName, cwd, 'project');
            pendingApproval.resolve(true);
            setPendingApproval(null);
          }}
        />
      ) : (
        <Box flexDirection="column">
          {!isProcessing && (
            <Box>
              <Text bold color="white">{'> '}</Text>
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
