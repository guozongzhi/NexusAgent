/**
 * PermissionPrompt — 工具执行权限确认弹窗
 * 使用 Ink 的 useInput 监听快捷键 [Y]/[N]
 */
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface PermissionPromptProps {
  toolName: string;
  argsSummary: string;
  onApprove: () => void;
  onReject: () => void;
}

export function PermissionPrompt({ toolName, argsSummary, onApprove, onReject }: PermissionPromptProps): React.ReactNode {
  const [hasResponded, setHasResponded] = useState(false);

  useInput((input, key) => {
    if (hasResponded) return;
    
    const char = input.toLowerCase();
    if (char === 'y' || key.return) {
      setHasResponded(true);
      onApprove();
    } else if (char === 'n' || key.escape) {
      setHasResponded(true);
      onReject();
    }
  });

  if (hasResponded) {
    return null;
  }

  return (
    <Box flexDirection="column" marginY={1} paddingLeft={2} borderStyle="round" borderColor="yellow">
      <Text color="yellowBright" bold>⚠ 需要执行权限</Text>
      <Text>Agent 试图调用 <Text bold color="cyan">{toolName}</Text></Text>
      <Text dimColor>参数: {argsSummary}</Text>
      
      <Box marginTop={1}>
        <Text color="gray">允许执行？</Text>
        <Text> [</Text>
        <Text color="green" bold>Y</Text>
        <Text>es/Enter] 或 [</Text>
        <Text color="red" bold>N</Text>
        <Text>o/Esc] </Text>
      </Box>
    </Box>
  );
}
