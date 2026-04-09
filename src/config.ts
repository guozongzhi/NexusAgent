/**
 * 配置加载器
 * 优先级：环境变量 → ~/.nexus/config.json → 默认值
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import type { NexusConfig } from './types/index.ts';

/** 配置文件的 Zod Schema — 运行时校验 */
const NexusConfigFileSchema = z.object({
  provider: z.enum(['openai', 'ollama']).optional(),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  mcpServers: z.record(z.object({
    command: z.string(),
    args: z.array(z.string()),
  })).optional(),
}).strict();

const DEFAULT_CONFIG: NexusConfig = {
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o',
  systemPrompt: '', // 由 context.ts 动态生成
  mcpServers: {},
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
    const parsed = JSON.parse(raw);
    // 运行时 Schema 校验
    const result = NexusConfigFileSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
      console.error(`[nexus] ⚠ 配置文件校验失败 (${configPath}):\n${issues}\n  将使用默认配置继续运行。`);
    } else {
      fileConfig = result.data as Partial<NexusConfig>;
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      console.error(`[nexus] ⚠ 配置文件解析出错: ${err.message}`);
    }
    // 配置文件不存在或解析失败，使用默认值
  }

  return {
    provider: (process.env['NEXUS_PROVIDER'] as NexusConfig['provider']) ?? fileConfig.provider ?? DEFAULT_CONFIG.provider,
    baseUrl: process.env['NEXUS_BASE_URL'] ?? process.env['OPENAI_BASE_URL'] ?? fileConfig.baseUrl ?? DEFAULT_CONFIG.baseUrl,
    apiKey: process.env['NEXUS_API_KEY'] ?? process.env['OPENAI_API_KEY'] ?? fileConfig.apiKey ?? DEFAULT_CONFIG.apiKey,
    model: process.env['NEXUS_MODEL'] ?? fileConfig.model ?? DEFAULT_CONFIG.model,
    systemPrompt: fileConfig.systemPrompt ?? DEFAULT_CONFIG.systemPrompt,
    mcpServers: fileConfig.mcpServers ?? DEFAULT_CONFIG.mcpServers,
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
