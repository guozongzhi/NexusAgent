#!/usr/bin/env bun
/**
 * Nexus Agent — CLI 入口
 * 基于 React + Ink 的终端交互界面
 * 复刻 Claude Code 的沉浸式 CLI 体验
 */
import React, { useState, useEffect, useRef } from 'react';
import { render, Box, Text, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { program } from 'commander';
import chalk from 'chalk';

// UI 组件
import { Welcome } from './components/Welcome.tsx';
import { Onboarding } from './components/Onboarding.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import { PermissionPrompt } from './components/PermissionPrompt.tsx';
import { ToolPanel } from './components/ToolPanel.tsx';
import { NexusSpinner } from './components/Spinner.tsx';

// 核心逻辑集成
import { QueryEngine } from './QueryEngine.ts';
import { builtinTools } from './tools/index.ts';
import { loadSession, saveSession } from './services/history/sessionStore.ts';
import { loadConfig } from './config.ts';
import { parseAndRouteCommand } from './commands/router.ts';
import { OpenAIAdapter } from './services/api/openai-adapter.ts';
import type { Message, ToolUseContext, StreamEvent, ToolExecution as TypesToolExecution } from './types/index.ts';
import { renderMarkdown } from './utils/markdown.ts';

const NEXUS_VERSION = "0.1.0";

export const READ_ONLY_TOOLS = ['file_read', 'list_dir', 'search', 'grep', 'glob'];

type DisplayMessage = Message & { displayRole?: 'user' | 'assistant' | 'system' };

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

function MessageBlock({ msg }: { msg: DisplayMessage }) {
  let tag = '';
  const role = msg.displayRole || msg.role;
  switch (role) {
    case 'user':
      tag = chalk.blue('▶ You');
      break;
    case 'assistant':
      tag = chalk.magenta('◆ Nexus');
      break;
    default:
      tag = chalk.yellow('⚠ System');
      break;
  }

  const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);

  const renderedContent = role === 'assistant' 
    ? (renderMarkdown ? renderMarkdown(content) : content) 
    : content;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>{tag}</Text>
      <Box paddingLeft={2}>
        <Text>{renderedContent}</Text>
      </Box>
    </Box>
  );
}

function NexusApp({ oneShotQuery }: { oneShotQuery?: string }) {
  const { exit } = useApp();
  const cwd = process.cwd();

  const [hasConfig, setHasConfig] = useState(false);
  const [inOnboarding, setInOnboarding] = useState(false);
  
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [inputValue, setInputValue] = useState(oneShotQuery || '');
  const [isProcessing, setIsProcessing] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [spinnerMode, setSpinnerMode] = useState<'idle' | 'think' | 'tool'>('idle');
  
  const [toolExecutions, setToolExecutions] = useState<ToolExecution[]>([]);
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);
  
  // 用于 Onboarding 检测的状态
  const [apiReady, setApiReady] = useState(false);
  const [apiError, setApiError] = useState<string | undefined>(undefined);

  const engineRef = useRef<QueryEngine | null>(null);

  useEffect(() => {
    const init = async () => {
      const conf = await loadConfig();
      // 这里根据实际配置字段做校验
      const API_KEY = (conf as any).NEXUS_API_KEY || (conf as any).apiKey || process.env.OPENAI_API_KEY;
      if (!API_KEY) {
        setInOnboarding(true);
      } else {
        setHasConfig(true);
        setApiReady(true);
      }

      const history = await loadSession(cwd);
      if (history && history.length > 0) {
        setMessages([
          { role: 'system', content: `已恢复 \`${cwd}\` 的历史会话。`, displayRole: 'system' } as DisplayMessage
        ]);
        // Actually load history into engine inside run
      }

      if (API_KEY) {
        const baseURL = (conf as any).NEXUS_BASE_URL || (conf as any).baseURL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
        const apiKey = API_KEY;
        const adapter = new OpenAIAdapter(baseURL, apiKey);
        engineRef.current = new QueryEngine(adapter);
      }

      if (oneShotQuery) {
        setTimeout(() => handleSubmit(oneShotQuery), 100);
      }
    };
    init();
  }, []);

  const handleSubmit = async (value: string) => {
    if (!value.trim() || isProcessing || pendingApproval) return;

    if (value.startsWith('/')) {
      const resp = await parseAndRouteCommand(value, {
        exit,
        clear: () => setMessages([]),
        reloadConfig: async () => {
           setMessages(prev => [...prev, { role: 'system', content: '配置已重载！', displayRole: 'system' } as DisplayMessage]);
        }
      });
      
      setMessages(prev => [
        ...prev,
        { role: 'user', content: value, displayRole: 'user' },
        { role: 'system', content: resp.output || '', displayRole: 'system' }
      ] as DisplayMessage[]);
      setInputValue('');
      return;
    }

    setInputValue('');
    const userMsg: DisplayMessage = { role: 'user', content: value, displayRole: 'user' };
    setMessages(prev => [...prev, userMsg]);
    setIsProcessing(true);
    setSpinnerMode('think');
    setToolExecutions([]);
    setStreamingText('');

    try {
      if (!engineRef.current) throw new Error("Engine not initialized");

      const sysPrompt = `你是 Nexus Agent，一个强大的命令行 AI 编程助手。当前目录: ${cwd}`;
      const conf = await loadConfig();

      const engineMsgs: Message[] = messages.map(m => ({ role: m.role, content: m.content }) as Message);
      engineMsgs.push({ role: 'user', content: value });

      // 使用 require 以跳过 typing 报错获取 getAllFunctionDefs（这部分已废除但可安全 mock）
      let toolDefs: any[] = [];
      try {
         const tools = require('./Tool.ts');
         toolDefs = tools.getAllFunctionDefs ? tools.getAllFunctionDefs() : [];
      } catch(e) {}

      const response = await engineRef.current.run({
        systemPrompt: sysPrompt,
        model: (conf as any).NEXUS_MODEL || process.env.OPENAI_MODEL || 'gpt-4o',
        messages: engineMsgs,
        toolDefs,
        toolContext: { cwd } as ToolUseContext,
        onTextDelta: (delta: string) => setStreamingText(prev => prev + delta),
        onToolStart: (id: string, name: string, args: any) => {
          setSpinnerMode('tool');
          setToolExecutions(prev => [...prev, { id, name, args, status: 'running' }]);
        },
        onToolEnd: (id: string, result: any, isError: boolean) => {
          setSpinnerMode('think');
          setToolExecutions(prev => prev.map(t => 
            t.id === id ? { ...t, status: isError ? 'error' : 'success', result: JSON.stringify(result) } : t
          ));
        },
        onToolApprovalRequest: async (toolName: string, args: any) => {
          if (READ_ONLY_TOOLS.includes(toolName)) {
            return true;
          }
          return new Promise<boolean>((resolve, reject) => {
            setPendingApproval({ toolName, argsSummary: JSON.stringify(args), resolve, reject });
          });
        }
      });

      const ans: DisplayMessage = { role: 'assistant', content: response.text || '', displayRole: 'assistant' };
      setMessages(prev => [...prev, ans]);
      
      engineMsgs.push({ role: 'assistant', content: response.text || '' });
      await saveSession(cwd, engineMsgs);
      
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'system', content: `执行出错: ${err.message}`, displayRole: 'system' } as DisplayMessage]);
    } finally {
      setIsProcessing(false);
      setSpinnerMode('idle');
      setStreamingText('');
      setToolExecutions([]);
    }
  };

  if (inOnboarding) {
    return <Onboarding apiReady={apiReady} apiError={apiError} />;
  }

  if (!hasConfig) {
    return null;
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Welcome version={NEXUS_VERSION} cwd={cwd} model="active" />
      
      {messages.map((m, i) => (
        <MessageBlock key={i} msg={m} />
      ))}

      {isProcessing && streamingText && (
        <Box paddingLeft={2} marginBottom={1}>
          <Text>{streamingText}</Text>
        </Box>
      )}

      {toolExecutions.length > 0 && (
        // @ts-ignore
        <ToolPanel tools={toolExecutions as any} shouldAnimate={true} />
      )}

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
        <Box marginTop={1} flexDirection="column">
          {!isProcessing && (
            <Box>
              <Text bold color="blue">▶ You: </Text>
              <TextInput 
                value={inputValue}
                onChange={setInputValue}
                onSubmit={handleSubmit}
              />
            </Box>
          )}
          
          <Box marginTop={1}>
            <NexusSpinner mode={spinnerMode as any} />
          </Box>
        </Box>
      )}

      <Box marginTop={1}>
        <StatusBar cwd={cwd} model="active" />
      </Box>
    </Box>
  );
}

program
  .name('nexus')
  .description('Nexus Agent - 强大的终端智能化生产力平台')
  .version(NEXUS_VERSION)
  .argument('[query...]', '一次性任务描述（非交互模式）')
  .action((queryArray) => {
    const oneShotQuery = queryArray?.join(' ');
    render(<NexusApp oneShotQuery={oneShotQuery} />);
  });

program.parse(process.argv);
