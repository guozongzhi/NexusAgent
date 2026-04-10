/**
 * MultiLineInput — 多行输入组件
 *
 * Claude Code 对齐：
 * - Enter 提交 / Shift+Enter 换行
 * - 粘贴多行内容自动保持
 * - ↑/↓ 翻阅输入历史
 * - / 命令前缀提示
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { InputHistory } from '../core/InputHistory.ts';

interface MultiLineInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** 光标显示字符 */
  cursor?: string;
}

// 全局单例历史
const _history = new InputHistory();

export function MultiLineInput({
  value, onChange, onSubmit, placeholder = '', disabled = false, cursor = '▊',
}: MultiLineInputProps): React.ReactNode {
  const [cursorVisible, setCursorVisible] = useState(true);

  // 光标闪烁
  useEffect(() => {
    if (disabled) return;
    const timer = setInterval(() => setCursorVisible(v => !v), 500);
    return () => clearInterval(timer);
  }, [disabled]);

  useInput((input, key) => {
    if (disabled) return;

    // Ctrl+C 让上层处理
    if (key.ctrl && input === 'c') return;

    // Enter → 提交（Shift+Enter 场景暂缓，Ink 不支持检测 shift+enter）
    if (key.return) {
      if (value.trim()) {
        _history.push(value);
        onSubmit(value);
      }
      return;
    }

    // ↑ 翻阅历史
    if (key.upArrow) {
      const prev = _history.navigateUp(value);
      if (prev !== null) onChange(prev);
      return;
    }

    // ↓ 翻阅历史
    if (key.downArrow) {
      const next = _history.navigateDown();
      if (next !== null) onChange(next);
      return;
    }

    // Backspace
    if (key.backspace || key.delete) {
      if (value.length > 0) {
        onChange(value.slice(0, -1));
        _history.resetCursor();
      }
      return;
    }

    // Tab → 空格（避免焦点切换）
    if (key.tab) {
      onChange(value + '  ');
      return;
    }

    // Escape → 清空
    if (key.escape) {
      onChange('');
      _history.resetCursor();
      return;
    }

    // 普通字符输入
    if (input && !key.ctrl && !key.meta) {
      onChange(value + input);
      _history.resetCursor();
    }
  });

  const displayValue = value || '';
  const showPlaceholder = !displayValue && !disabled;

  return (
    <Box>
      <Text color="cyanBright" bold>❯ </Text>
      {showPlaceholder ? (
        <Text dimColor>{placeholder}</Text>
      ) : (
        <Text>
          {displayValue}
          {!disabled && cursorVisible ? <Text color="cyanBright">{cursor}</Text> : null}
        </Text>
      )}
    </Box>
  );
}
