import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from 'ink';
import { QueryEngine } from '../QueryEngine.ts';
import { loadSession, saveSession, getCurrentSessionId } from '../services/history/sessionStore.ts';
import { loadConfig } from '../config.ts';
import { parseAndRouteCommand } from '../commands/router.ts';
import { createAdapter } from '../services/api/adapterFactory.ts';
import type { Message, ToolUseContext, LLMAdapter } from '../types/index.ts';
import { buildSystemPrompt, buildSystemPromptAsync } from '../context.ts';
import { getAllFunctionDefs, getTool } from '../tools/index.ts';
import type { SpinnerMode } from '../components/Spinner.tsx';
import { hasCompletedOnboarding } from '../components/Onboarding.tsx';
import { truncateMessages } from '../services/history/tokenWindow.ts';
import { autoCompactIfNeeded, createAutoCompactState } from '../services/compact/index.ts';
import { isToolAutoApproved } from '../security/permissionStore.ts';
import { mcpManager } from '../services/mcp/McpClientManager.ts';
import { READ_ONLY_TOOLS } from '../main.tsx';

// ─── 类型 ──────────────────────────────────────────────
export type CompletedMessage = {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export type ToolExecution = {
  id: string;
  name: string;
  args: any;
  status: 'running' | 'success' | 'error';
  result?: string;
};

export type ApprovalRequest = {
  toolName: string;
  argsSummary: string;
  resolve: (approved: boolean) => void;
  reject: () => void;
};

let _msgIdCounter = 0;
export function nextMsgId(): number {
  return ++_msgIdCounter;
}

export function useAgentLoop({ 
  oneShotQuery, 
  skipPermissions,
  cwd
}: { 
  oneShotQuery?: string;
  skipPermissions?: boolean;
  cwd: string;
}) {
  const { exit } = useApp();

  const [completedMessages, setCompletedMessages] = useState<CompletedMessage[]>([]);
  const [inputValue, setInputValue] = useState(oneShotQuery || '');
  const [isProcessing, setIsProcessing] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [spinnerMode, setSpinnerMode] = useState<SpinnerMode | 'idle'>('idle');
  const [toolExecutions, setToolExecutions] = useState<ToolExecution[]>([]);
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);
  const [ready, setReady] = useState(false);
  const [tokenCount, setTokenCount] = useState(0);
  const [modelName, setModelName] = useState('active');
  const [showOnboarding, setShowOnboarding] = useState(() => !hasCompletedOnboarding());
  const [apiReady, setApiReady] = useState(false);
  const [apiError, setApiError] = useState<string | undefined>();

  const engineRef = useRef<QueryEngine | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const historyRef = useRef<Message[]>([]);
  const autoCompactStateRef = useRef(createAutoCompactState());
  const adapterRef = useRef<LLMAdapter | null>(null);

  const streamBufferRef = useRef('');
  const streamFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstChunkRef = useRef(true);

  const flushStreamBuffer = useCallback(() => {
    if (streamBufferRef.current) {
      const chunk = streamBufferRef.current;
      streamBufferRef.current = '';
      setStreamingText(prev => prev + chunk);
    }
  }, []);

  const interrupt = useCallback(() => {
    if (isProcessing && abortControllerRef.current) {
      setCompletedMessages(prev => [
        ...prev,
        { id: nextMsgId(), role: 'system', content: '[WARNING] 用户已中断当前操作。' }
      ]);
      abortControllerRef.current.abort();
    } else {
      exit();
      process.exit(0);
    }
  }, [isProcessing, exit]);

  // 1. 初始化
  useEffect(() => {
    const init = async () => {
      const conf = await loadConfig();
      const apiKey = conf.apiKey || process.env.OPENAI_API_KEY || 'UNSET_KEY_WAITING_FOR_USER';

      const adapter = createAdapter(conf);
      adapterRef.current = adapter;
      engineRef.current = new QueryEngine(adapter);

      const history = await loadSession(cwd);
      if (history && history.length > 0) {
        historyRef.current = history;
        setCompletedMessages(prev => [
          ...prev,
          { id: nextMsgId(), role: 'system', content: `已恢复 \`${cwd}\` 的历史会话。` },
        ]);
      }

      const actualModel = conf.model || process.env.OPENAI_MODEL || 'gpt-4o';
      setModelName(actualModel);

      if (conf.mcpServers) {
        await mcpManager.connectAll(conf.mcpServers);
      }

      if (apiKey && apiKey !== 'UNSET_KEY_WAITING_FOR_USER') {
        setApiReady(true);
      } else {
        setApiError('API Key 未配置');
      }

      setReady(true);
    };
    init();

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
  }, [cwd]);

  // One shot
  const oneShotFiredRef = useRef(false);
  useEffect(() => {
    if (ready && oneShotQuery && !oneShotFiredRef.current) {
      oneShotFiredRef.current = true;
      handleSubmit(oneShotQuery);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, oneShotQuery]);

  const handleSubmit = async (value: string) => {
    let query = value;
    if (!query.trim() || isProcessing || pendingApproval) return;

    let resp: any;
    if (query.startsWith('/')) {
      resp = await parseAndRouteCommand(query, {
        exit,
        clear: () => setCompletedMessages([]),
        reloadConfig: async () => {
          const newConf = await loadConfig();
          const newBase = newConf.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
          const newAdapter = createAdapter(newConf);
          engineRef.current = new QueryEngine(newAdapter);
          const actualModel = newConf.model || process.env.OPENAI_MODEL || 'gpt-4o';
          setModelName(actualModel);

          if (newConf.mcpServers) {
            await mcpManager.closeAll();
            await mcpManager.connectAll(newConf.mcpServers);
          }

          setCompletedMessages(prev => [
            ...prev,
            { id: nextMsgId(), role: 'system', content: `配置已热重载！\n当前 BaseURL: ${newBase}\n当前模型: ${actualModel}` },
          ]);
        },
        getHistory: () => historyRef.current,
        setHistory: (msgs) => { historyRef.current = msgs; },
        getTokenCount: () => tokenCount,
        getModel: () => modelName,
        extractWorkspaceContext: async () => {
          if (!engineRef.current) return null;
          setIsProcessing(true);
          setSpinnerMode('thinking');
          try {
            const { extractProjectFacts } = await import('../services/memory/WorkspaceGraph.ts');
            return await extractProjectFacts(cwd, engineRef.current, modelName);
          } finally {
            setIsProcessing(false);
            setSpinnerMode('idle');
          }
        }
      });

      if (resp.rewrittenQuery) {
        setCompletedMessages(prev => [
          ...prev,
          { id: nextMsgId(), role: 'user', content: query },
          { id: nextMsgId(), role: 'system', content: `已触发技能，引擎转入自动化工作流。` },
        ]);
        query = resp.rewrittenQuery;
        setInputValue('');
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

      let sysPrompt: string;
      try {
        sysPrompt = await buildSystemPromptAsync(cwd);
      } catch (promptErr: any) {
        sysPrompt = buildSystemPrompt(cwd);
        setCompletedMessages(prev => [...prev, { id: nextMsgId(), role: 'system', content: `⚠ System Prompt 构建异常 (${promptErr.message})，已降级处理。` }]);
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
        if (acResult.compactionResult) historyRef.current = acResult.messages;
      }

      const trimmedMessages = truncateMessages(workingMessages);
      const localToolDefs = getAllFunctionDefs();
      const mcpToolsRaw = await mcpManager.getAllTools();
      const mcpToolDefs: import('../types/index.ts').OpenAIFunctionDef[] = mcpToolsRaw.map(t => ({
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
          if (skipPermissions) return true;

          const toolInstance = getTool(toolName);
          const isMcp = toolName.startsWith('mcp__');
          const rawAuth = isMcp ? 'requires_confirm' : (toolInstance?.authType || (toolInstance?.isReadOnly ? 'safe' : 'requires_confirm'));
          const authType = READ_ONLY_TOOLS.includes(toolName) && !isMcp ? 'safe' : rawAuth;
          
          if (authType === 'safe') return true;
          if (authType !== 'dangerous') {
            const isApproved = await isToolAutoApproved(toolName, cwd);
            if (isApproved) return true;
          }
          return new Promise<boolean>((resolve, reject) => {
            setPendingApproval({ toolName, argsSummary: JSON.stringify(args), resolve, reject });
          });
        },
      });

      if (streamFlushRef.current) {
        clearTimeout(streamFlushRef.current);
        streamFlushRef.current = null;
      }
      flushStreamBuffer();
      streamBufferRef.current = '';

      const answerText = response.text || '';
      setCompletedMessages(prev => [
        ...prev,
        { id: nextMsgId(), role: 'assistant', content: answerText },
      ]);

      historyRef.current.push({ role: 'assistant', content: answerText });
      await saveSession(cwd, historyRef.current);

      if (response.usage) {
        setTokenCount(prev => prev + response.usage.promptTokens + response.usage.completionTokens);
        import('../services/telemetry/CostTracker.ts').then(({ costTracker }) => {
          costTracker.recordUsage(actualModel, {
            promptTokens: response.usage.promptTokens,
            completionTokens: response.usage.completionTokens,
            totalTokens: response.usage.promptTokens + response.usage.completionTokens
          });
        });
      }
    } catch (err: any) {
      if (err.name !== 'AbortError' && !err.message.includes('abort')) {
        setCompletedMessages(prev => [
          ...prev,
          { id: nextMsgId(), role: 'system', content: `执行出错: ${err.message}` },
        ]);
      }
    } finally {
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

  return {
    ready,
    apiReady,
    apiError,
    showOnboarding,
    setShowOnboarding,
    modelName,
    completedMessages,
    setCompletedMessages,
    inputValue,
    setInputValue,
    isProcessing,
    streamingText,
    spinnerMode,
    toolExecutions,
    pendingApproval,
    setPendingApproval,
    tokenCount,
    handleSubmit,
    interrupt
  };
}
