/**
 * useAgentLoop — Agent 循环编排 Hook
 *
 * 重构版：降级为薄编排层（~200行），所有业务逻辑委托到核心模块：
 * - AgentState: 集中状态管理
 * - MessageReducer: 不可变消息操作
 * - StreamProcessor: 流式 buffer
 * - ToolRouter: 工具调度
 * - PermissionManager: 权限判定
 * - InterruptController: 中断控制
 */
import { useState, useEffect, useRef, useCallback, useSyncExternalStore } from 'react';
import { useApp } from 'ink';
import { QueryEngine } from '../QueryEngine.ts';
import { loadSession, saveSession, getCurrentSessionId } from '../services/history/sessionStore.ts';
import { loadConfig } from '../config.ts';
import { parseAndRouteCommand } from '../commands/router.ts';
import { createAdapter } from '../services/api/adapterFactory.ts';
import type { Message, LLMAdapter } from '../types/index.ts';
import { buildSystemPrompt, buildSystemPromptAsync } from '../context.ts';
import { getAllFunctionDefs } from '../tools/index.ts';
import type { SpinnerMode } from '../components/Spinner.tsx';
import { hasCompletedOnboarding } from '../components/Onboarding.tsx';
import { truncateMessages } from '../services/history/tokenWindow.ts';
import { autoCompactIfNeeded, createAutoCompactState } from '../services/compact/index.ts';
import { mcpManager } from '../services/mcp/McpClientManager.ts';

// 核心模块
import { AgentState } from '../core/AgentState.ts';
import {
  appendMessage, appendUserMessage, appendSystemMessage, appendAssistantMessage, appendThinkingMessage,
  addToolExecution, completeToolExecution,
  type CompletedMessage, type ToolExecution, type ApprovalRequest,
} from '../core/MessageReducer.ts';
import { StreamProcessor } from '../core/StreamProcessor.ts';
import { ToolRouter } from '../core/ToolRouter.ts';
import { PermissionManager } from '../core/PermissionManager.ts';
import { InterruptController } from '../core/InterruptController.ts';

// 重导出类型（保持外部 API 兼容）
export type { CompletedMessage, ToolExecution, ApprovalRequest };

export function useAgentLoop({
  oneShotQuery,
  skipPermissions,
  cwd,
}: {
  oneShotQuery?: string;
  skipPermissions?: boolean;
  cwd: string;
}) {
  const { exit } = useApp();

  // ─── 核心模块实例（进程生命周期）───────────────────
  const stateRef = useRef(new AgentState());
  const interruptRef = useRef(new InterruptController());
  const engineRef = useRef<QueryEngine | null>(null);
  const historyRef = useRef<Message[]>([]);
  const autoCompactStateRef = useRef(createAutoCompactState());
  const adapterRef = useRef<LLMAdapter | null>(null);
  const permissionManagerRef = useRef<PermissionManager | null>(null);
  const toolRouterRef = useRef<ToolRouter | null>(null);

  // StreamProcessor 需要和 React 状态桥接
  const streamProcessorRef = useRef<StreamProcessor | null>(null);

  // ─── React 状态桥接（订阅 AgentState）──────────────
  const agentState = stateRef.current;

  // 使用 useSyncExternalStore 桥接外部状态到 React
  const snapshot = useSyncExternalStore(
    useCallback((cb: () => void) => agentState.subscribe(cb), [agentState]),
    useCallback(() => agentState.getState(), [agentState]),
  );

  // ─── 初始化 ────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      const conf = await loadConfig();
      const adapter = createAdapter(conf);
      adapterRef.current = adapter;
      engineRef.current = new QueryEngine(adapter);

      // 初始化权限管理器 + 工具路由器
      permissionManagerRef.current = new PermissionManager({
        skipPermissions: skipPermissions ?? false,
        cwd,
      });
      toolRouterRef.current = new ToolRouter(permissionManagerRef.current);

      // 初始化流处理器
      streamProcessorRef.current = new StreamProcessor({
        flushIntervalMs: 150, // 从 50ms 调高至 150ms 极大降低巨量输出时的排版算力消耗和终端闪烁
        onFlush: (chunk) => {
          const prev = agentState.getState().streamingText;
          agentState.setState({ streamingText: prev + chunk });
        },
      });

      // 恢复会话
      const history = await loadSession(cwd);
      if (history && history.length > 0) {
        historyRef.current = history;
        agentState.setState({
          completedMessages: appendSystemMessage(
            agentState.getState().completedMessages,
            `已恢复 \`${cwd}\` 的历史会话。`
          ),
        });
      }

      const actualModel = conf.model || process.env.OPENAI_MODEL || 'gpt-4o';
      agentState.setState({ 
        modelName: actualModel,
        agentMode: conf.mode || 'act'
      });
      permissionManagerRef.current?.setMode(conf.mode || 'act');

      if (conf.mcpServers) {
        await mcpManager.connectAll(conf.mcpServers);
      }

      const apiKey = conf.apiKey || process.env.OPENAI_API_KEY || 'UNSET_KEY_WAITING_FOR_USER';
      if (apiKey && apiKey !== 'UNSET_KEY_WAITING_FOR_USER') {
        agentState.setState({ apiReady: true });
      } else {
        agentState.setState({ apiError: 'API Key 未配置' });
      }

      agentState.setState({
        ready: true,
        showOnboarding: !hasCompletedOnboarding(),
      });

      // 后台项目画像扫描 (L2 Discovery)
      import('../services/memory/DiscoveryService.ts').then(async ({ discoveryService }) => {
        const profile = await discoveryService.discover(cwd);
        agentState.setState({ projectProfile: profile });
      });

      // 订阅后台挂起进程状态
      import('../core/JobManager.ts').then(({ JobManager }) => {
        if (cleanupDone) return;
        jobSub = JobManager.getInstance().subscribe(() => {
          agentState.setState({ activeBackgroundJobs: JobManager.getInstance().getActiveJobCount() });
        });
      });
    };
    
    let cleanupDone = false;
    let jobSub: (() => void) | null = null;
    init();

    // 清理
    const shutdownHandler = () => {
      mcpManager.closeAll().catch(() => {});
    };
    process.on('exit', shutdownHandler);
    process.on('SIGINT', shutdownHandler);
    process.on('SIGTERM', shutdownHandler);

    return () => {
      cleanupDone = true;
      if (jobSub) jobSub();
      streamProcessorRef.current?.dispose();
      process.removeListener('exit', shutdownHandler);
      process.removeListener('SIGINT', shutdownHandler);
      process.removeListener('SIGTERM', shutdownHandler);
    };
  }, [cwd]);

  // ─── One-shot 模式 ──────────────────────────────────
  const oneShotFiredRef = useRef(false);
  useEffect(() => {
    if (snapshot.ready && oneShotQuery && !oneShotFiredRef.current) {
      oneShotFiredRef.current = true;
      handleSubmit(oneShotQuery);
    }
  }, [snapshot.ready, oneShotQuery]);

  // ─── 中断处理 ──────────────────────────────────────
  const interrupt = useCallback(() => {
    if (snapshot.isProcessing && interruptRef.current.isActive) {
      agentState.setState({
        completedMessages: appendSystemMessage(
          agentState.getState().completedMessages,
          '[WARNING] 用户已中断当前操作。'
        ),
      });
      interruptRef.current.abort();
    } else {
      exit();
      process.exit(0);
    }
  }, [snapshot.isProcessing, exit]);

  // ─── 提交处理 ──────────────────────────────────────
  const handleSubmit = async (value: string) => {
    let query = value;
    if (!query.trim() || snapshot.isProcessing || snapshot.pendingApproval) return;

    // 斜杠命令处理
    let resp: any;
    if (query.startsWith('/')) {
      resp = await parseAndRouteCommand(query, {
        exit,
        clear: () => agentState.setState({ completedMessages: [] }),
        reloadConfig: async () => {
          const newConf = await loadConfig();
          const newAdapter = createAdapter(newConf);
          adapterRef.current = newAdapter;
          engineRef.current = new QueryEngine(newAdapter);
          const actualModel = newConf.model || process.env.OPENAI_MODEL || 'gpt-4o';
          agentState.setState({ modelName: actualModel });

          if (newConf.mcpServers) {
            await mcpManager.closeAll();
            await mcpManager.connectAll(newConf.mcpServers);
          }

          const newBase = newConf.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
          agentState.setState({
            completedMessages: appendSystemMessage(
              agentState.getState().completedMessages,
              `配置已热重载！\n当前 BaseURL: ${newBase}\n当前模型: ${actualModel}`
            ),
          });
        },
        getHistory: () => historyRef.current,
        setHistory: (msgs) => { historyRef.current = msgs; },
        getTokenCount: () => agentState.getState().tokenCount,
        getModel: () => agentState.getState().modelName,
        extractWorkspaceContext: async () => {
          if (!engineRef.current) return null;
          agentState.setState({ isProcessing: true, spinnerMode: 'thinking' });
          try {
            const { extractProjectFacts } = await import('../services/memory/WorkspaceGraph.ts');
            return await extractProjectFacts(cwd, engineRef.current, agentState.getState().modelName);
          } finally {
            agentState.setState({ isProcessing: false, spinnerMode: 'idle' });
          }
        },
        setMode: (mode) => {
          agentState.setState({ agentMode: mode });
          permissionManagerRef.current?.setMode(mode);
        },
        getProjectProfile: () => agentState.getState().projectProfile,
      });

      if (resp.rewrittenQuery) {
        let msgs = agentState.getState().completedMessages;
        msgs = appendUserMessage(msgs, query);
        msgs = appendSystemMessage(msgs, '已触发技能，引擎转入自动化工作流。');
        agentState.setState({ completedMessages: msgs, inputValue: '' });
        query = resp.rewrittenQuery;
      } else {
        let msgs = agentState.getState().completedMessages;
        msgs = appendUserMessage(msgs, query);
        msgs = appendSystemMessage(msgs, resp.output || '');
        agentState.setState({ completedMessages: msgs, inputValue: '' });
        return;
      }
    }

    // 普通查询
    if (!resp?.rewrittenQuery && !query.startsWith('/')) {
      agentState.setState({
        inputValue: '',
        completedMessages: appendUserMessage(agentState.getState().completedMessages, query),
      });
    }

    // 开始处理
    agentState.setState({
      isProcessing: true,
      spinnerMode: 'thinking',
      toolExecutions: [],
      streamingText: '',
      thinkingText: '',
    });
    streamProcessorRef.current?.reset();
    const abortController = interruptRef.current.create();

    try {
      if (!engineRef.current) throw new Error('Engine not initialized. 请运行 /config set apiKey <your-key> 配置 API Key。');

      let sysPrompt: string;
      try {
        const curProfile = agentState.getState().projectProfile;
        sysPrompt = await buildSystemPromptAsync(cwd, curProfile);
      } catch (promptErr: any) {
        sysPrompt = buildSystemPrompt(cwd, agentState.getState().projectProfile);
        agentState.setState({
          completedMessages: appendSystemMessage(
            agentState.getState().completedMessages,
            `⚠ System Prompt 构建异常 (${promptErr.message})，已降级处理。`
          ),
        });
      }

      let conf;
      try {
        conf = await loadConfig();
      } catch (confErr: any) {
        throw new Error(`配置加载失败: ${confErr.message}。请检查 ~/.nexus/config.json 格式是否正确。`);
      }

      historyRef.current.push({ role: 'user', content: query });
      const actualModel = conf.model || process.env.OPENAI_MODEL || 'gpt-4o';
      let workingMessages = [...historyRef.current];

      // 自动压缩
      if (adapterRef.current) {
        const acResult = await autoCompactIfNeeded(
          workingMessages,
          autoCompactStateRef.current,
          {
            adapter: adapterRef.current,
            model: actualModel,
            systemPrompt: sysPrompt,
            onProgress: (status) => {
              agentState.setState({
                completedMessages: appendSystemMessage(
                  agentState.getState().completedMessages,
                  status,
                ),
              });
            },
          },
        );
        workingMessages = acResult.messages;
        if (acResult.compactionResult) historyRef.current = acResult.messages;
      }

      const trimmedMessages = truncateMessages(workingMessages);

      // 收集工具定义
      const localToolDefs = getAllFunctionDefs();
      const mcpToolsRaw = await mcpManager.getAllTools();
      const mcpToolDefs = mcpToolsRaw.map(t => ({
        type: 'function' as const,
        function: {
          name: `mcp__${t.serverName}__${t.toolName}`,
          description: `[外部 MCP 工具: ${t.serverName}] ${t.description}`,
          parameters: t.inputSchema,
        },
      }));
      const toolDefs = [...localToolDefs, ...mcpToolDefs];

      // 1. 动态挂载预估 Prompt Token (1 Token ≈ 4 Chars) 保证发送请求即有 UI 反馈
      let localEstimatedPrompt = Math.ceil(JSON.stringify(trimmedMessages).length / 4);
      let localEstimatedCompletion = 0;
      let generatedChars = 0;
      let pendingAddedTokens = 0;
      let lastTokenUpdate = Date.now();

      const preRunState = agentState.getState();
      agentState.setState({
        promptTokens: preRunState.promptTokens + localEstimatedPrompt,
        tokenCount: preRunState.tokenCount + localEstimatedPrompt,
      });

      // 调用 QueryEngine
      const response = await engineRef.current.run({
        systemPrompt: sysPrompt,
        model: actualModel,
        messages: trimmedMessages,
        toolDefs,
        toolRouter: toolRouterRef.current ?? undefined,
        toolContext: {
          cwd,
          sessionId: getCurrentSessionId(),
          isAuthorized: skipPermissions ?? false,
        },
        abortSignal: abortController.signal,
        onThinking: (delta: string) => {
          const prev = agentState.getState().thinkingText;
          agentState.setState({ thinkingText: prev + delta });
        },
        onTextDelta: (delta: string) => {
          streamProcessorRef.current?.push(delta);
          
          // 2. 流式阶段实时模拟 Token 下发累加（增加 Throttle 避免渲染狂闪）
          generatedChars += delta.length;
          if (generatedChars >= 4) {
            const addedTokens = Math.floor(generatedChars / 4);
            generatedChars %= 4;
            localEstimatedCompletion += addedTokens;
            pendingAddedTokens += addedTokens;
          }
          
          if (pendingAddedTokens > 0 && Date.now() - lastTokenUpdate > 100) {
            const curState = agentState.getState();
            agentState.setState({
              completionTokens: curState.completionTokens + pendingAddedTokens,
              tokenCount: curState.tokenCount + pendingAddedTokens,
            });
            pendingAddedTokens = 0;
            lastTokenUpdate = Date.now();
          }
        },
        onToolStart: (name: string, args: any) => {
          agentState.setState({
            spinnerMode: 'tool' as SpinnerMode,
            toolExecutions: addToolExecution(agentState.getState().toolExecutions, name, args),
          });
        },
        onToolEnd: (name: string, result: any, isError: boolean, durationMs: number) => {
          agentState.setState({
            spinnerMode: 'thinking',
            toolExecutions: completeToolExecution(agentState.getState().toolExecutions, name, JSON.stringify(result), isError),
          });
        },
        onToolApprovalRequest: async (toolName: string, args: any) => {
          // 权限逻辑已由 ToolRouter + PermissionManager 处理
          // 此处仅提供 UI 交互桥接
          return new Promise<boolean>((resolve, reject) => {
            agentState.setState({
              pendingApproval: { toolName, argsSummary: JSON.stringify(args), fullArgs: args, resolve, reject },
            });
          });
        },
        onRetry: (attempt: number, maxRetries: number, delayMs: number, error: string) => {
          agentState.setState({
            completedMessages: appendSystemMessage(
              agentState.getState().completedMessages,
              `⚠ [API 请求失败] 正在重试 (${attempt}/${maxRetries})... 延时 ${delayMs}ms\n原因: ${error}`
            ),
          });
        },
      });

      // 完成处理
      streamProcessorRef.current?.finalize();

      // 沉淀 thinking 消息（如果有 extended thinking 输出）
      const thinkingText = agentState.getState().thinkingText;
      if (thinkingText.trim()) {
        agentState.setState({
          completedMessages: appendThinkingMessage(agentState.getState().completedMessages, thinkingText),
          thinkingText: '',
        });
      }

      const answerText = response.text || '';
      agentState.setState({
        completedMessages: appendAssistantMessage(agentState.getState().completedMessages, answerText),
      });

      historyRef.current.push({ role: 'assistant', content: answerText });
      await saveSession(cwd, historyRef.current);

      if (response.usage) {
        const freshState = agentState.getState();
        // 3. 结束时使用服务端的真实 Token 修正估算带来的误差
        const deltaPrompt = response.usage.promptTokens - localEstimatedPrompt;
        const deltaComp = response.usage.completionTokens - localEstimatedCompletion;

        agentState.setState({ 
          tokenCount: freshState.tokenCount + deltaPrompt + deltaComp,
          promptTokens: freshState.promptTokens + deltaPrompt,
          completionTokens: freshState.completionTokens + deltaComp,
        });

        import('../services/telemetry/CostTracker.ts').then(({ costTracker }) => {
          const record = costTracker.recordUsage(actualModel, {
            promptTokens: response.usage.promptTokens,
            completionTokens: response.usage.completionTokens,
            totalTokens: response.usage.promptTokens + response.usage.completionTokens,
          });
          agentState.setState({ sessionCostUsd: agentState.getState().sessionCostUsd + record.costUsd });
        });
      }

      // L3 经验沉淀引擎：触发后台复盘
      if (historyRef.current.length >= 3 && adapterRef.current) {
        agentState.setState({ isLearning: true });
        import('../services/memory/DistillationService.ts').then(async ({ distillationService }) => {
          try {
            await distillationService.extractAndRecord(
              cwd, 
              historyRef.current, 
              adapterRef.current!, 
              actualModel
            );
          } finally {
            agentState.setState({ isLearning: false });
          }
        });
      }
    } catch (err: any) {
      if (err.name !== 'AbortError' && !err.message?.includes('abort')) {
        agentState.setState({
          completedMessages: appendSystemMessage(
            agentState.getState().completedMessages,
            `执行出错: ${err.message}`
          ),
        });
      }
    } finally {
      streamProcessorRef.current?.finalize();
      interruptRef.current.reset();
      agentState.setState({
        isProcessing: false,
        spinnerMode: 'idle',
        streamingText: '',
        thinkingText: '',
        toolExecutions: [],
      });
    }
  };

  // ─── 返回接口（保持向后兼容）──────────────────────
  return {
    ready: snapshot.ready,
    apiReady: snapshot.apiReady,
    apiError: snapshot.apiError,
    showOnboarding: snapshot.showOnboarding,
    setShowOnboarding: (v: boolean) => agentState.setState({ showOnboarding: v }),
    modelName: snapshot.modelName,
    completedMessages: snapshot.completedMessages,
    setCompletedMessages: (msgs: CompletedMessage[] | ((prev: CompletedMessage[]) => CompletedMessage[])) => {
      if (typeof msgs === 'function') {
        agentState.setState({ completedMessages: msgs(agentState.getState().completedMessages) });
      } else {
        agentState.setState({ completedMessages: msgs });
      }
    },
    inputValue: snapshot.inputValue,
    setInputValue: (v: string) => agentState.setState({ inputValue: v }),
    isProcessing: snapshot.isProcessing,
    streamingText: snapshot.streamingText,
    thinkingText: snapshot.thinkingText,
    spinnerMode: snapshot.spinnerMode,
    toolExecutions: snapshot.toolExecutions,
    pendingApproval: snapshot.pendingApproval,
    setPendingApproval: (v: ApprovalRequest | null) => agentState.setState({ pendingApproval: v }),
    tokenCount: snapshot.tokenCount,
    promptTokens: snapshot.promptTokens,
    completionTokens: snapshot.completionTokens,
    contextWindow: snapshot.contextWindow,
    contextUsedTokens: snapshot.contextUsedTokens,
    sessionCostUsd: snapshot.sessionCostUsd,
    activeBackgroundJobs: snapshot.activeBackgroundJobs,
    agentMode: snapshot.agentMode,
    isLearning: snapshot.isLearning,
    handleSubmit,
    setMode: (mode: any) => {
      agentState.setState({ agentMode: mode });
      permissionManagerRef.current?.setMode(mode);
    },
    interrupt,
  };
}
