/**
 * LLM 适配器工厂
 * 根据配置中的 provider 字段创建对应的 LLMAdapter 实例
 */
import type { NexusConfig, LLMAdapter } from '../../types/index.ts';
import { OpenAIAdapter } from './openai-adapter.ts';

/**
 * 根据配置创建对应的 LLM 适配器实例
 * 目前 ollama / vLLM / LiteLLM 均兼容 OpenAI 协议，
 * 但工厂层确保了未来添加原生适配器时的零改动扩展能力
 */
export function createAdapter(config: NexusConfig): LLMAdapter {
  const apiKey = config.apiKey || process.env['NEXUS_API_KEY'] || process.env['OPENAI_API_KEY'] || 'UNSET';
  const baseUrl = config.baseUrl || process.env['NEXUS_BASE_URL'] || process.env['OPENAI_BASE_URL'] || 'https://api.openai.com/v1';

  switch (config.provider) {
    case 'ollama':
      // Ollama 本身兼容 OpenAI 协议，使用相同适配器但默认 base URL 不同
      const ollamaBase = baseUrl.includes('openai.com')
        ? 'http://localhost:11434/v1'  // 用户未自定义 URL 时的 Ollama 默认地址
        : baseUrl;
      return new OpenAIAdapter(ollamaBase, apiKey || 'ollama');

    case 'openai':
    default:
      return new OpenAIAdapter(baseUrl, apiKey);
  }
}
