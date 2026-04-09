import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export interface SkillDefinition {
  name: string;
  description: string;
  prompt: string;
}

const SKILLS_DIR = path.join(os.homedir(), '.nexus', 'skills');

/**
 * 确保目录存在
 */
async function ensureDir() {
  await fs.mkdir(SKILLS_DIR, { recursive: true });
}

/**
 * 获取所有加载的技能
 */
export async function getAllSkills(): Promise<SkillDefinition[]> {
  await ensureDir();
  const files = await fs.readdir(SKILLS_DIR);
  const skills: SkillDefinition[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const content = await fs.readFile(path.join(SKILLS_DIR, file), 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed.name && parsed.prompt) {
        skills.push({
          name: parsed.name,
          description: parsed.description || '',
          prompt: parsed.prompt,
        });
      }
    } catch {
      // 忽略解析失败的技能文件
    }
  }
  return skills;
}

/**
 * 创建或更新一个示例技能
 */
export async function createSkill(name: string, description: string, prompt: string): Promise<string> {
  await ensureDir();
  const filePath = path.join(SKILLS_DIR, `${name}.json`);
  const data = JSON.stringify({ name, description, prompt }, null, 2);
  await fs.writeFile(filePath, data, 'utf-8');
  return filePath;
}

/**
 * 删除一个技能
 */
export async function removeSkill(name: string): Promise<boolean> {
  await ensureDir();
  const filePath = path.join(SKILLS_DIR, `${name}.json`);
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}
