import fs from 'node:fs/promises';
import path from 'node:path';

export interface ProjectProfile {
  frameworks: string[];
  languages: string[];
  mainEntry?: string;
  scripts: string[];
  type: 'monorepo' | 'polyrepo' | 'unknown';
  keyFiles: string[];
}

export class DiscoveryService {
  /**
   * 自动探测项目画像（零成本、无 LLM）
   */
  public async discover(cwd: string): Promise<ProjectProfile> {
    const profile: ProjectProfile = {
      frameworks: [],
      languages: [],
      scripts: [],
      type: 'polyrepo',
      keyFiles: [],
    };

    try {
      const entries = await fs.readdir(cwd);
      profile.keyFiles = entries.filter(e => 
        ['package.json', 'tsconfig.json', 'go.mod', 'requirements.txt', 'cargo.toml', 'NEXUS.md', 'README.md', 'vite.config.ts', 'next.config.js'].includes(e.toLowerCase())
      );

      // 1. Node.js / TS 探测
      if (entries.includes('package.json')) {
        profile.languages.push('TypeScript/JavaScript');
        try {
          const pkg = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf-8'));
          profile.scripts = Object.keys(pkg.scripts || {});
          
          // 框架识别
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };
          if (deps['react']) profile.frameworks.push('React');
          if (deps['next']) profile.frameworks.push('Next.js');
          if (deps['vue']) profile.frameworks.push('Vue');
          if (deps['@nestjs/core']) profile.frameworks.push('NestJS');
          if (deps['ink']) profile.frameworks.push('Ink (CLI UI)');
        } catch {}
      }

      // 2. Go 探测
      if (entries.includes('go.mod')) {
        profile.languages.push('Go');
        profile.frameworks.push('Go Modules');
      }

      // 3. Python 探测
      if (entries.includes('requirements.txt') || entries.includes('pyproject.toml')) {
        profile.languages.push('Python');
      }

      // 4. Monorepo 探测
      if (entries.includes('pnpm-workspace.yaml') || entries.includes('lerna.json')) {
        profile.type = 'monorepo';
      }

      // 5. 特征目录识别
      if (entries.includes('src')) profile.keyFiles.push('src/');
      if (entries.includes('tests') || entries.includes('test')) profile.keyFiles.push('tests/');

    } catch (err) {
      // 容错处理，返回空画像
    }

    return profile;
  }

  /**
   * 格式化画像为 System Prompt 片段
   */
  public formatAsPrompt(profile: ProjectProfile): string {
    const lines = [
      '## <PROJECT_PROFILE> 当前项目画像 (Auto-Discovered)',
      `- **语言**: ${profile.languages.join(', ') || '未知'}`,
      `- **框架**: ${profile.frameworks.join(', ') || '原生/无'}`,
      `- **项目类型**: ${profile.type}`,
      `- **探测到的关键路径/文件**: ${profile.keyFiles.join(', ')}`,
      `- **可用脚本**: ${profile.scripts.length > 5 ? profile.scripts.slice(0, 5).join(', ') + '...' : profile.scripts.join(', ')}`,
      '</PROJECT_PROFILE>'
    ];
    return lines.join('\n');
  }
}

export const discoveryService = new DiscoveryService();
