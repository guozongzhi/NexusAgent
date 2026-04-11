import type { Message, LLMAdapter } from '../../types/index.ts';
import { addMemory } from './memoryStore.ts';

export class DistillationService {
  /**
   * 分析对话历史，提炼工程事实
   */
  public async extractAndRecord(
    cwd: string, 
    messages: Message[], 
    adapter: LLMAdapter, 
    model: string
  ): Promise<string | null> {
    // 只分析有一定长度的对话，且包含 user 和 assistant 的互动
    if (messages.length < 3) return null;

    const distillationPrompt = `
你是一个资深的工程经验提炼专家 (L3 Knowledge Distiller)。
请分析以下一段 Agent 与用户的对话历史，提炼出具有持久化价值的“工程事实”或“避坑指南”。

**目标**:
1. 识别出项目中非标准的命令、工作流或环境配置。
2. 识别出 Agent 曾经犯过的错误以及被纠正后的正确方案。
3. 提炼成极简的、无废话的“知识指针”。

**限制**:
1. 不要包含任何私密代码。
2. 保持单条知识在 100 字以内。
3. 如果对话中没有值得记录的新知识，请直接返回“NONE”。
4. **不要**输出 JSON 或 Markdown 包裹，只输出知识文本。

**待分析对话片段**:
---
${messages.map(m => `[${m.role}]: ${typeof m.content === 'string' ? m.content.slice(0, 1000) : '工具调用数据...'}`).join('\n')}
---
    `;

    try {
      // 使用较轻量的模型调用进行提炼
      const response = await adapter.stream({
        model,
        systemPrompt: "You are a concise engineering knowledge extractor.",
        messages: [{ role: 'user', content: distillationPrompt }],
        maxTokens: 500,
        temperature: 0.3,
        tools: [],
      });

      let learning = '';
      for await (const event of response) {
        if (event.type === 'text_delta') {
          learning += event.text;
        }
      }

      const finalLearning = learning.trim();
      if (finalLearning && finalLearning !== 'NONE' && finalLearning.length > 5) {
        await addMemory(cwd, `【经验沉淀】${finalLearning}`, false);
        return finalLearning;
      }
    } catch (err) {
      // 容错：沉淀过程不应中断主流程
    }

    return null;
  }
}

export const distillationService = new DistillationService();
