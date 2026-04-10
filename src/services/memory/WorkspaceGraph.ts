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

  // 2. 组装提取 Prompt
  const prompt = `
你是一个资深的系统架构师分析引擎 (Nexus Graph Extractor)。
请根据以下工作区的文件信息，精准地提炼出该项目的事实图谱（Project Facts），必须包含：
1. 技术栈 (Tech Stack)
2. 架构模式 (Architecture Pattern/File Structure Concept)
3. 开发规范 (如果有发现的话)

使用极其简练的列表形式（Markdown）输出，剔除任何闲聊废话。你的输出将作为长效缓存记忆被后续的 Agent 引用。

--- [Project Directory Structure] ---
${structure}

--- [package.json (Snippet)] ---
${packageJson.slice(0, 1000)}

--- [NEXUS.md / README.md (Snippet)] ---
${nexusMd.slice(0, 1000) || readme.slice(0, 1000) || '无'}
`;

  // 3. 调用无副作用的引擎端点（绕过用户的界面流）
  try {
    const response = await engine.run({
      systemPrompt: 'You are Nexus Project Analyzer.',
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

    const snippet = response.text?.trim();
    if (snippet) {
      // 保存至 memoryStore
      await addMemory(cwd, `【系统自动抽取的架构图谱】\n${snippet}`, false);
      return snippet;
    }
  } catch (err) {
    console.error('Fact Extraction Failed:', err);
  }
  return null;
}
