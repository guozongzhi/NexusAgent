/**
 * Compact Prompt — LLM 摘要压缩的 Prompt 模板
 *
 * 参考 Claude Code 的 prompt.ts：9 段式结构化摘要，
 * 确保压缩后关键上下文不丢失。
 */

/**
 * 获取压缩摘要的 system prompt
 * @param customInstructions 用户自定义的压缩指令
 */
export function getCompactPrompt(customInstructions?: string): string {
  let prompt = COMPACT_PROMPT;
  if (customInstructions && customInstructions.trim()) {
    prompt += `\n\n## 额外压缩指令\n${customInstructions}`;
  }
  return prompt;
}

/**
 * 格式化 LLM 返回的摘要：剥离 <analysis> 标签，提取 <summary> 内容
 */
export function formatCompactSummary(summary: string): string {
  let result = summary;

  // 剥离 analysis 区域（仅用于 LLM 内部推理，不需要保留）
  result = result.replace(/<analysis>[\s\S]*?<\/analysis>/g, '');

  // 提取 summary 标签内容
  const match = result.match(/<summary>([\s\S]*?)<\/summary>/);
  if (match) {
    result = match[1]?.trim() ?? result;
  }

  // 清理多余空行
  result = result.replace(/\n{3,}/g, '\n\n');
  return result.trim();
}

/**
 * 构建压缩后注入给 LLM 的 "会话恢复" 消息
 */
export function getCompactUserSummaryMessage(
  summary: string,
  suppressFollowUp: boolean,
): string {
  const formatted = formatCompactSummary(summary);

  let msg = `本会话从之前的对话延续而来，以下摘要涵盖了之前的全部内容。

${formatted}`;

  if (suppressFollowUp) {
    msg += `\n\n请直接从上次中断的地方继续工作，不要提问确认、不要复述摘要，直接接续之前的任务。`;
  }

  return msg;
}

// ─── 核心 Prompt ─────────────────────────────────────────

const COMPACT_PROMPT = `你的任务是创建一份详细的对话摘要，精确捕获用户的请求和你之前的操作。
这份摘要应该全面记录技术细节、代码模式和架构决策，确保在不丢失上下文的情况下继续开发工作。

在提供摘要之前，先用 <analysis> 标签组织你的思考过程：

1. 按时间顺序分析每一轮对话，识别：
   - 用户的显式请求和意图
   - 你采取的解决方案
   - 关键决策、技术概念和代码模式
   - 具体细节：文件名、代码片段、函数签名、文件编辑
   - 遇到的错误以及修复方式
   - 特别注意用户的反馈，尤其是他们要求你调整的地方
2. 检查技术准确性和完整性

你的摘要必须包含以下章节：

1. **主要请求与意图**: 详细捕获用户的所有显式请求和意图
2. **关键技术概念**: 列出讨论到的重要技术概念、技术栈和框架
3. **文件与代码**: 列举查看、修改或创建的文件。包含完整代码片段和变更摘要
4. **错误与修复**: 列出遇到的所有错误及修复方法，包含用户反馈
5. **问题解决**: 描述已解决和正在排查的问题
6. **用户消息**: 列出所有非 tool_result 的用户消息（这对理解用户反馈至关重要）
7. **待办任务**: 列出用户明确要求的待处理任务
8. **当前工作**: 精确描述在此摘要请求之前正在进行的工作，包含文件名和代码片段
9. **下一步计划**: 列出与最近工作直接相关的下一步操作。如果最后的任务已完成，仅列出用户明确要求的后续。包含最近对话中的直接引用

输出格式：

<analysis>
[你的分析推理过程]
</analysis>

<summary>
1. 主要请求与意图:
   [详细描述]

2. 关键技术概念:
   - [概念1]
   - [概念2]

3. 文件与代码:
   - [文件名1]
     - [变更摘要]
     - [关键代码片段]

4. 错误与修复:
   - [错误描述]:
     - [修复方式]

5. 问题解决:
   [描述]

6. 用户消息:
   - [消息内容]

7. 待办任务:
   - [任务1]

8. 当前工作:
   [描述]

9. 下一步计划:
   [计划]

</summary>

请根据到目前为止的对话提供摘要，遵循上述结构并确保精确和完整。
请勿调用任何工具，仅以纯文本形式回复。`;
