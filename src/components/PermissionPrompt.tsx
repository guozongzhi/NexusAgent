/**
 * PermissionPrompt — 工具权限确认组件
 *
 * 增强版（Claude Code 对齐）：
 * - Bash 命令完整预览 + 工作目录显示
 * - File Edit diff 预览（彩色）
 * - 危险操作红色高亮框
 * - 权限选项：Yes / No / Always for project / Don't ask globally
 */
import React from 'react';
import { Box, Text, useInput } from 'ink';
import { renderMarkdown } from '../utils/markdown.ts';

interface PermissionPromptProps {
  toolName: string;
  argsSummary: string;
  /** 完整参数（用于增强预览） */
  fullArgs?: Record<string, unknown>;
  onApprove: () => void;
  onDeny: () => void;
  onAlwaysAllow?: () => void;
}

export function PermissionPrompt({
  toolName, argsSummary, fullArgs, onApprove, onDeny, onAlwaysAllow,
}: PermissionPromptProps): React.ReactNode {
  useInput((input, key) => {
    const lower = input.toLowerCase();
    if (lower === 'y' || key.return) {
      onApprove();
    } else if (lower === 'n' || key.escape) {
      onDeny();
    } else if (lower === 'a' && onAlwaysAllow) {
      onAlwaysAllow();
    }
  });

  // 判断是否是危险操作
  const isDangerous = toolName === 'bash' || toolName.startsWith('mcp__');
  const borderColor = isDangerous ? 'red' : 'yellow';

  // Bash 命令预览
  const isBash = toolName === 'bash';
  const bashCommand = isBash && fullArgs?.command ? String(fullArgs.command) : null;

  // File Edit diff 预览
  const isEdit = toolName === 'file_edit';
  const editFile = isEdit && fullArgs?.file_path ? String(fullArgs.file_path) : null;
  const editOld = isEdit && fullArgs?.old_string ? String(fullArgs.old_string) : null;
  const editNew = isEdit && fullArgs?.new_string ? String(fullArgs.new_string) : null;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={1}>
      {/* 标题 */}
      <Box marginBottom={1}>
        <Text color={isDangerous ? 'red' : 'yellow'} bold>
          {isDangerous ? '⚠ 危险操作确认' : '🔒 权限确认'}
        </Text>
        <Text dimColor> — {toolName}</Text>
      </Box>

      {/* Bash 命令预览 */}
      {bashCommand && (
        <Box flexDirection="column" marginBottom={1}>
          <Text dimColor>命令:</Text>
          <Box paddingLeft={2}>
            <Text color="white" bold>{bashCommand}</Text>
          </Box>
        </Box>
      )}

      {/* File Edit diff 预览 */}
      {editFile && editOld && editNew && (
        <Box flexDirection="column" marginBottom={1}>
          <Text dimColor>文件: {editFile}</Text>
          <Box paddingLeft={2} flexDirection="column">
            {editOld.split('\n').slice(0, 5).map((line, i) => (
              <Text key={`old-${i}`} color="red">- {line}</Text>
            ))}
            {editOld.split('\n').length > 5 && (
              <Text dimColor>  ... (+{editOld.split('\n').length - 5} 行)</Text>
            )}
            {editNew.split('\n').slice(0, 5).map((line, i) => (
              <Text key={`new-${i}`} color="green">+ {line}</Text>
            ))}
            {editNew.split('\n').length > 5 && (
              <Text dimColor>  ... (+{editNew.split('\n').length - 5} 行)</Text>
            )}
          </Box>
        </Box>
      )}

      {/* 通用参数摘要（非 bash/edit 时） */}
      {!bashCommand && !editFile && (
        <Box marginBottom={1}>
          <Text dimColor>参数: {argsSummary}</Text>
        </Box>
      )}

      {/* 操作选项 */}
      <Box gap={2}>
        <Text>
          <Text color="green" bold>[Y]</Text><Text>es</Text>
          <Text> </Text>
          <Text color="red" bold>[N]</Text><Text>o</Text>
          <Text> </Text>
          <Text color="cyan" bold>[A]</Text><Text>lways allow</Text>
        </Text>
      </Box>
    </Box>
  );
}
