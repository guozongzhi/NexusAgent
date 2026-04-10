/**
 * ChatScreen — 对话主视图
 *
 * 增强版：
 * - MultiLineInput 替代 TextInput（支持历史回溯）
 * - StatusBar 集成上下文进度条 + 实时成本
 * - PermissionPrompt 增强（Bash 命令预览 + diff）
 * - ToolPanel 增强（实时计时 + basename 显示）
 * - Thinking block 可折叠渲染
 */
import React from 'react';
import { Box, Text, Static } from 'ink';
import { renderMarkdown } from '../utils/markdown.ts';
import { padToTermWidth } from '../utils/path.ts';
import { StatusBar } from '../components/StatusBar.tsx';
import { PermissionPrompt } from '../components/PermissionPrompt.tsx';
import { ToolPanel, getToolDisplayName, getToolParamSummary } from '../components/ToolPanel.tsx';
import { NexusSpinner } from '../components/Spinner.tsx';
import { MultiLineInput } from '../components/MultiLineInput.tsx';
import type { SpinnerMode } from '../components/Spinner.tsx';
import type { CompletedMessage, ToolExecution, ApprovalRequest } from '../hooks/useAgentLoop.ts';
import { addAutoApprovedTool } from '../security/permissionStore.ts';

// ─── 消息块渲染（用于 Static 内的已完成消息）──────────
function StaticMessageBlock({ item }: { item: CompletedMessage }) {
  if (item.role === 'user') {
    const padded = padToTermWidth(' ' + item.content);
    return (
      <Box marginTop={1}>
        <Text backgroundColor="blackBright" color="white">{padded}</Text>
      </Box>
    );
  }

  if (item.role === 'assistant') {
    const content = renderMarkdown(item.content);
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text color="white" bold>{'● '}</Text>
          <Text wrap="wrap">{content}</Text>
        </Box>
      </Box>
    );
  }

  // thinking block — 灰色折叠样式
  if (item.role === 'thinking') {
    return (
      <Box marginBottom={1} paddingLeft={2}>
        <Text dimColor italic>💭 {item.content.length > 200 ? item.content.slice(0, 200) + '...' : item.content}</Text>
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

export interface ChatScreenProps {
  cwd: string;
  modelName: string;
  completedMessages: CompletedMessage[];
  inputValue: string;
  setInputValue: (val: string) => void;
  isProcessing: boolean;
  streamingText: string;
  spinnerMode: SpinnerMode | 'idle';
  toolExecutions: ToolExecution[];
  pendingApproval: ApprovalRequest | null;
  setPendingApproval: (val: ApprovalRequest | null) => void;
  tokenCount: number;
  handleSubmit: (val: string) => void;
  /** 上下文窗口 */
  contextWindow?: number;
  contextUsedTokens?: number;
  sessionCostUsd?: number;
}

export function ChatScreen({
  cwd,
  modelName,
  completedMessages,
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
  contextWindow = 128_000,
  contextUsedTokens = 0,
  sessionCostUsd = 0,
}: ChatScreenProps) {
  const { useProactiveTips } = require('../hooks/useProactiveTips.ts');
  const activeTip = useProactiveTips(inputValue);

  return (
    <>
      <Static items={completedMessages}>
        {(msg) => <StaticMessageBlock key={msg.id} item={msg} />}
      </Static>

      {isProcessing && streamingText && (
        <Box marginBottom={1}>
          <Text color="white" bold>{'● '}</Text>
          <Text wrap="wrap">{renderMarkdown(streamingText)}</Text>
        </Box>
      )}

      {toolExecutions.length > 0 && (
        <ToolPanel tools={toolExecutions.map(t => ({
          ...t,
          displayName: getToolDisplayName(t.name),
          paramSummary: getToolParamSummary(t.name, t.args ?? {}),
        }))} shouldAnimate={true} />
      )}

      {pendingApproval ? (
        <PermissionPrompt
          toolName={pendingApproval.toolName}
          argsSummary={pendingApproval.argsSummary}
          fullArgs={pendingApproval.fullArgs}
          onApprove={() => {
            pendingApproval.resolve(true);
            setPendingApproval(null);
          }}
          onDeny={() => {
            pendingApproval.resolve(false);
            setPendingApproval(null);
          }}
          onAlwaysAllow={() => {
            void addAutoApprovedTool(pendingApproval.toolName, cwd, 'project');
            pendingApproval.resolve(true);
            setPendingApproval(null);
          }}
        />
      ) : (
        <Box flexDirection="column">
          {!isProcessing && (
            <Box flexDirection="column">
              <MultiLineInput
                value={inputValue}
                onChange={setInputValue}
                onSubmit={handleSubmit}
                placeholder="输入消息... (↑/↓ 翻阅历史)"
                disabled={isProcessing}
              />
              {/* 启发式输入提示 */}
              {activeTip && (
                <Box marginLeft={2} marginTop={0}>
                  <Text dimColor italic color="yellow">{activeTip.text}</Text>
                </Box>
              )}
            </Box>
          )}

          {isProcessing && spinnerMode !== 'idle' && (
            <Box paddingX={1}>
              <NexusSpinner mode={spinnerMode as SpinnerMode} />
            </Box>
          )}
        </Box>
      )}

      <Box marginTop={1} paddingX={1}>
        <StatusBar
          cwd={cwd}
          model={modelName}
          tokenCount={tokenCount}
          isProcessing={isProcessing}
          contextWindow={contextWindow}
          contextUsedTokens={contextUsedTokens}
          sessionCostUsd={sessionCostUsd}
        />
      </Box>
    </>
  );
}
