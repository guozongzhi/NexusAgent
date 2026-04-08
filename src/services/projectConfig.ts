/**
 * NEXUS.md — 项目级指令文件支持
 *
 * 参考 Claude Code 的 CLAUDE.md：
 * 从工作目录及父目录加载 NEXUS.md 文件，注入 system prompt。
 * 支持嵌套：子目录的指令追加到父目录之后。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';

/** 支持的项目配置文件名（按优先级） */
const CONFIG_FILENAMES = ['NEXUS.md', '.nexus.md'];

/**
 * 从工作目录向上搜索 NEXUS.md 文件
 * 返回所有找到的内容（从根目录到 cwd，即父目录优先）
 */
export async function loadProjectInstructions(cwd: string): Promise<string[]> {
  const results: string[] = [];

  // 1. 全局 ~/.nexus/NEXUS.md
  const globalPath = path.join(homedir(), '.nexus', 'NEXUS.md');
  const globalContent = await tryReadFile(globalPath);
  if (globalContent) {
    results.push(`# 全局指令 (~/.nexus/NEXUS.md)\n${globalContent}`);
  }

  // 2. 从根目录到 cwd 逐级搜索
  const segments: string[] = [];
  let current = cwd;
  const root = path.parse(current).root;

  // 收集路径链
  while (current !== root && current !== homedir()) {
    segments.unshift(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // 逐级加载
  for (const dir of segments) {
    for (const filename of CONFIG_FILENAMES) {
      const filePath = path.join(dir, filename);
      const content = await tryReadFile(filePath);
      if (content) {
        const relative = path.relative(cwd, dir) || '.';
        results.push(`# 项目指令 (${relative}/${filename})\n${content}`);
        break; // 同一目录只取第一个匹配
      }
    }
  }

  return results;
}

/**
 * 合并所有项目指令为单一字符串
 */
export async function getProjectInstructions(cwd: string): Promise<string | undefined> {
  const instructions = await loadProjectInstructions(cwd);
  if (instructions.length === 0) return undefined;
  return instructions.join('\n\n---\n\n');
}

async function tryReadFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}
