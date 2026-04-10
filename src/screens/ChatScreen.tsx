import React from 'react';
import { Box, Text, Static } from 'ink';
import TextInput from 'ink-text-input';
import { renderMarkdown } from '../utils/markdown.ts';
import { padToTermWidth } from '../utils/path.ts';
import { StatusBar } from '../components/StatusBar.tsx';
import { PermissionPrompt } from '../components/PermissionPrompt.tsx';
import { ToolPanel } from '../components/ToolPanel.tsx';
import { NexusSpinner } from '../components/Spinner.tsx';
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
    const content = renderMarkdown ? renderMarkdown(item.content) : item.content;
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
  handleSubmit
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
          <Text wrap="wrap">{renderMarkdown ? renderMarkdown(streamingText) : streamingText}</Text>
        </Box>
      )}

      {toolExecutions.length > 0 && (
        <ToolPanel tools={toolExecutions.map(t => ({
          ...t,
          displayName: t.name,
        }))} shouldAnimate={true} />
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
              <Box>
                <Text bold color="white">{'> '}</Text>
                <TextInput
                  value={inputValue}
                  onChange={setInputValue}
                  onSubmit={handleSubmit}
                />
              </Box>
              {/* 高阶启发式输入提示 */}
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
        <StatusBar cwd={cwd} model={modelName} tokenCount={tokenCount} isProcessing={isProcessing} />
      </Box>
    </>
  );
}
