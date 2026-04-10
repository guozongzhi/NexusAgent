import path from 'node:path';
import fs from 'node:fs/promises';
import type { QueryEngine } from '../../QueryEngine.ts';
import { addMemory } from './memoryStore.ts';

/**
 * 读取关键的项目描述文件
 */
async function safeReadFile(filePath: string): Promise<string> {
  try {
    const stat = await fs.stat(filePath);
    if (stat.isFile() && stat.size < 50000) { // 只读取 50KB 以下的文件
      return await fs.readFile(filePath, 'utf-8');
    }
  } catch {
    // 忽略找不到或无法读取的文件
  }
  return '';
}

/**
 * 读取顶层目录结构
 */
async function getTopLevelStructure(cwd: string): Promise<string> {
  try {
    const entries = await fs.readdir(cwd, { withFileTypes: true });
    return entries
      .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
      .map(e => (e.isDirectory() ? `[Dir]  ${e.name}` : `[File] ${e.name}`))
      .join('\n');
  } catch {
    return '无法读取目录结构';
  }
}

/**
 * 后台智能提取当前工程的事实（Tech Stack, Rules, Architecture），并记录为一条长效局部记忆。
 */
export async function extractProjectFacts(cwd: string, engine: QueryEngine, model: string): Promise<string | null> {
  // 1. 搜集上下文
  const packageJson = await safeReadFile(path.join(cwd, 'package.json'));
  const readme = await safeReadFile(path.join(cwd, 'README.md'));
  const nexusMd = await safeReadFile(path.join(cwd, 'NEXUS.md'));
  const structure = await getTopLevelStructure(cwd);

  if (!packageJson && !readme && !structure) {
    return null; // 没有足够的信息
  }

  // 2. 组装提取 Prompt (L2 Pointer Layer)
  const prompt = `
你是一个资深的系统架构师分析引擎 (L2 Index Builder)。
请根据以下工作区的文件信息，精准地提炼出该项目的事实图谱（Project Knowledge Pointers）。

**核心使命**: 存储指针映射，而非完整知识。保持 AI 工作内存精简准确！
请严格输出一个合并架构规范与重要模块路径的 JSON 结构，范例如下：
{
  "tech_stack": ["React", "Ink", "TypeScript"],
  "rules": ["使用 ESModules", "禁止随意更改构建配置"],
  "pointers": {
    "src/commands": "CLI 命令注册点",
    "src/tools": "外挂 Agent 工具层",
    "src/services": "底层核心服务（如记忆、遥测、MCP）"
  }
}

⚠️ **强制要求**:
1. 你的返回内容必须是合法的 JSON (可以直接经过 JSON.parse 解析)。
2. 不要包含任何 \`\`\`json 的包裹，纯输出内容。
3. 剔除任何闲聊废话，只保留项目的真实现状。

--- [Project Directory Structure] ---
${structure}
--- [package.json] ---
${packageJson ? packageJson.slice(0, 3000) : '未找到'}
--- [README.md] ---
${readme ? readme.slice(0, 2000) : '未找到'}
--- [NEXUS.md] ---
${nexusMd || '未找到'}
`;

  try {
    const response = await engine.run({
      systemPrompt: 'You are a JSON-only Project Knowledge Extractor.',
      messages: [{ role: 'user', content: prompt }],
      model,
      toolDefs: [],
      toolContext: {
        cwd: cwd,
        sessionId: 'analysis',
        isAuthorized: true,
      },
      abortSignal: undefined,
    });

    const rawText = response.text?.trim() || '';
    
    // 简单清洗可能存在的 Markdown codeblock 标记
    let cleanJson = rawText;
    if (cleanJson.startsWith('```json')) cleanJson = cleanJson.slice(7);
    if (cleanJson.startsWith('```')) cleanJson = cleanJson.slice(3);
    if (cleanJson.endsWith('```')) cleanJson = cleanJson.slice(0, -3);
    cleanJson = cleanJson.trim();

    if (cleanJson) {
      // 验证 JSON
      JSON.parse(cleanJson);
      // 保存至 memoryStore
      await addMemory(cwd, `【L2 Knowledge Pointers】\n${cleanJson}`, false);
      return cleanJson;
    }
  } catch (err) {
    // 忽略提取错误或 JSON 校验失败（L3 拦截）
  }
  return null;
}
