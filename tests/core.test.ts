/**
 * 工具注册和核心模块测试
 * 覆盖：工具注册表、buildTool、共用工具函数
 */
import { describe, test, expect } from 'bun:test';
import { getAllTools, getTool, getAllFunctionDefs } from '../src/tools/index.ts';
import { shortenPath, formatTokens } from '../src/utils/path.ts';
import { buildSystemPrompt } from '../src/context.ts';

describe('工具注册表', () => {
  test('所有 6 个工具应该被注册', () => {
    const tools = getAllTools();
    expect(tools.length).toBe(6);
  });

  test('工具查找正确', () => {
    expect(getTool('bash')).toBeDefined();
    expect(getTool('file_read')).toBeDefined();
    expect(getTool('file_write')).toBeDefined();
    expect(getTool('file_edit')).toBeDefined();
    expect(getTool('glob')).toBeDefined();
    expect(getTool('grep')).toBeDefined();
  });

  test('查找不存在的工具返回 undefined', () => {
    expect(getTool('nonexistent')).toBeUndefined();
  });

  test('getAllFunctionDefs 返回正确的 OpenAI 格式', () => {
    const defs = getAllFunctionDefs();
    expect(defs.length).toBe(6);

    for (const def of defs) {
      expect(def.type).toBe('function');
      expect(def.function.name).toBeDefined();
      expect(def.function.description).toBeDefined();
      expect(def.function.parameters).toBeDefined();
    }
  });

  test('每个工具都有 isReadOnly 属性', () => {
    const tools = getAllTools();
    const readOnlyTools = tools.filter(t => t.isReadOnly);
    const writeTools = tools.filter(t => !t.isReadOnly);
    
    // file_read, glob, grep 是只读
    expect(readOnlyTools.length).toBe(3);
    // bash, file_write, file_edit 是写入
    expect(writeTools.length).toBe(3);
  });
});

describe('shortenPath — 路径缩短', () => {
  test('HOME 路径缩短为 ~', () => {
    const home = process.env['HOME'] ?? '/Users/test';
    const result = shortenPath(`${home}/projects/myapp`);
    expect(result).toBe('~/projects/myapp');
  });

  test('非 HOME 路径保持不变', () => {
    expect(shortenPath('/etc/config')).toBe('/etc/config');
  });
});

describe('formatTokens — Token 数格式化', () => {
  test('小数字直接显示', () => {
    expect(formatTokens(500)).toBe('500');
  });

  test('k 级别', () => {
    expect(formatTokens(1500)).toBe('1.5k');
    expect(formatTokens(50000)).toBe('50.0k');
  });

  test('大数字显示', () => {
    expect(formatTokens(150000)).toBe('150k');
  });
});

describe('buildSystemPrompt', () => {
  test('包含工作目录', () => {
    const prompt = buildSystemPrompt('/test/dir');
    expect(prompt).toContain('/test/dir');
  });

  test('包含核心能力描述', () => {
    const prompt = buildSystemPrompt('/test');
    expect(prompt).toContain('Nexus Agent');
    expect(prompt).toContain('核心能力');
  });
});
