/**
 * 配置加载器
 * 优先级：环境变量 → ~/.nexus/config.json → 默认值
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import type { NexusConfig } from './types/index.ts';

const DEFAULT_CONFIG: NexusConfig = {
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o',
  systemPrompt: '', // 由 context.ts 动态生成
};

/**
 * 加载配置
 * 环境变量优先级最高
 */
export async function loadConfig(): Promise<NexusConfig> {
  let fileConfig: Partial<NexusConfig> = {};

  // 尝试读取 ~/.nexus/config.json
  const configPath = path.join(homedir(), '.nexus', 'config.json');
  try {
    const raw = await readFile(configPath, 'utf-8');
    fileConfig = JSON.parse(raw) as Partial<NexusConfig>;
  } catch {
    // 配置文件不存在，使用默认值
  }

  return {
    provider: (process.env['NEXUS_PROVIDER'] as NexusConfig['provider']) ?? fileConfig.provider ?? DEFAULT_CONFIG.provider,
    baseUrl: process.env['NEXUS_BASE_URL'] ?? process.env['OPENAI_BASE_URL'] ?? fileConfig.baseUrl ?? DEFAULT_CONFIG.baseUrl,
    apiKey: process.env['NEXUS_API_KEY'] ?? process.env['OPENAI_API_KEY'] ?? fileConfig.apiKey ?? DEFAULT_CONFIG.apiKey,
    model: process.env['NEXUS_MODEL'] ?? fileConfig.model ?? DEFAULT_CONFIG.model,
    systemPrompt: fileConfig.systemPrompt ?? DEFAULT_CONFIG.systemPrompt,
  };
}

/**
 * 更新配置文件并持久化
 */
export async function updateConfig(updates: Partial<NexusConfig>): Promise<void> {
  const configDir = path.join(homedir(), '.nexus');
  const configPath = path.join(configDir, 'config.json');

  let currentConfig: Partial<NexusConfig> = {};
  try {
    const raw = await readFile(configPath, 'utf-8');
    currentConfig = JSON.parse(raw);
  } catch {
    // 文件不存在则为空对象
  }

  const merged = { ...currentConfig, ...updates };

  await mkdir(configDir, { recursive: true });
  // 设置 mode 0o600 防止其他用户读取 API Key
  await writeFile(configPath, JSON.stringify(merged, null, 2), { mode: 0o600 });
}
