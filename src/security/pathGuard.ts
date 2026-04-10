/**
 * 安全防护模块
 * P1-5: 路径遍历防护 + 危险命令黑名单 + 文件大小写入上限
 */
import path from 'node:path';

// ─── 路径安全 ──────────────────────────────────────────

/**
 * 验证目标路径是否在允许的工作目录范围内
 * 防止路径遍历攻击（如 ../../etc/passwd）
 *
 * 安全措施：
 * - Unicode NFC 规范化（防止 Unicode 标准化攻击）
 * - 反斜杠转换（防止 Windows 风格路径注入）
 * - 路径遍历检测
 */
export function validatePath(targetPath: string, cwd: string): { safe: boolean; resolved: string; error?: string } {
  // Unicode NFC 规范化，防止 Unicode 标准化绕过
  const normalizedTarget = targetPath.normalize('NFC').replace(/\\/g, '/');
  const normalizedCwd = cwd.normalize('NFC');

  const resolved = path.isAbsolute(normalizedTarget)
    ? path.resolve(normalizedTarget)
    : path.resolve(normalizedCwd, normalizedTarget);

  // 允许 cwd 本身及其子目录
  if (!resolved.startsWith(normalizedCwd + path.sep) && resolved !== normalizedCwd) {
    // 特例：允许 HOME 下的配置目录
    const home = process.env['HOME'] ?? '';
    if (home && resolved.startsWith(home + path.sep)) {
      return { safe: true, resolved };
    }
    return {
      safe: false,
      resolved,
      error: `路径越界: ${resolved} 不在工作目录 ${normalizedCwd} 范围内`,
    };
  }

  return { safe: true, resolved };
}

// ─── 敏感文件保护 ──────────────────────────────────────

/** 写入操作中禁止修改的敏感文件模式 */
const SENSITIVE_FILE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\/(\.zshrc|\.bashrc|\.bash_profile|\.profile)$/, reason: '禁止修改 shell 配置文件' },
  { pattern: /\/\.gitconfig$/, reason: '禁止修改 git 全局配置' },
  { pattern: /\/\.ssh\//, reason: '禁止修改 SSH 配置和密钥' },
  { pattern: /\/\.gnupg\//, reason: '禁止修改 GPG 配置和密钥' },
  { pattern: /\/\.npmrc$/, reason: '禁止修改 npm 配置（可能含 token）' },
  { pattern: /\/\.env\.local$/, reason: '禁止修改本地环境变量文件' },
  { pattern: /\/\.aws\/credentials$/, reason: '禁止修改 AWS 凭证' },
  { pattern: /\/\.kube\/config$/, reason: '禁止修改 Kubernetes 配置' },
];

/**
 * 验证是否为写入操作的敏感路径
 * 仅在写入/编辑操作中检查，读取不受限制
 */
export function validateSensitivePath(targetPath: string): { safe: boolean; reason?: string } {
  const normalized = targetPath.normalize('NFC');
  for (const { pattern, reason } of SENSITIVE_FILE_PATTERNS) {
    if (pattern.test(normalized)) {
      return { safe: false, reason };
    }
  }
  return { safe: true };
}

// ─── 命令黑名单 ──────────────────────────────────────────

/** 危险命令模式（正则匹配） */
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/\s*$/, reason: '禁止删除根目录' },
  { pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+\//, reason: '禁止递归删除根路径' },
  { pattern: /\brm\s+-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*\s+\//, reason: '禁止递归删除根路径' },
  { pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, reason: '禁止 fork 炸弹' },
  { pattern: /\bdd\s+.*of=\/dev\/[sh]d/, reason: '禁止直接写入磁盘设备' },
  { pattern: /\bmkfs\b/, reason: '禁止格式化文件系统' },
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/, reason: '禁止关机/重启' },
  { pattern: />\s*\/dev\/[sh]d/, reason: '禁止重定向到磁盘设备' },
  { pattern: /\bcurl\b.*\|\s*(ba)?sh/, reason: '禁止管道执行远程脚本' },
  { pattern: /\bwget\b.*\|\s*(ba)?sh/, reason: '禁止管道执行远程脚本' },
  { pattern: /\bchmod\s+777\s+\//, reason: '禁止对根路径设置不安全权限' },
  { pattern: /\bchown\s+.*\s+\//, reason: '禁止修改根路径所有者' },
];

/** 子命令注入模式 — 检测 $(...) 和 `...` 嵌套 */
const INJECTION_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\$\(\s*(curl|wget|nc|ncat)\b/, reason: '禁止通过子命令注入执行远程内容' },
  { pattern: /`\s*(curl|wget|nc|ncat)\b/, reason: '禁止通过反引号注入执行远程内容' },
  { pattern: /\beval\s+["'\$]/, reason: '禁止 eval 动态执行（高风险注入向量）' },
  { pattern: /\bsource\s+<\(/, reason: '禁止 process substitution 加载远程脚本' },
  { pattern: /\bexec\s+\d*[<>]/, reason: '禁止文件描述符重定向攻击' },
];

/**
 * 检查命令是否安全（含子命令注入检测）
 */
export function validateCommand(command: string): { safe: boolean; reason?: string } {
  const trimmed = command.trim();

  // 基础危险命令检测
  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { safe: false, reason };
    }
  }

  // 子命令注入检测
  for (const { pattern, reason } of INJECTION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { safe: false, reason };
    }
  }

  return { safe: true };
}

// ─── 符号链接防护 ──────────────────────────────────────

import { lstatSync, realpathSync } from 'node:fs';

/**
 * 检测路径是否为符号链接指向工作目录外的位置
 * 防止通过 symlink 绕过路径限制
 */
export function validateSymlink(targetPath: string, cwd: string): { safe: boolean; reason?: string } {
  try {
    const stat = lstatSync(targetPath);
    if (stat.isSymbolicLink()) {
      const realPath = realpathSync(targetPath);
      const normalizedCwd = cwd.normalize('NFC');
      const home = process.env['HOME'] ?? '';
      if (
        !realPath.startsWith(normalizedCwd + path.sep) &&
        realPath !== normalizedCwd &&
        !(home && realPath.startsWith(home + path.sep))
      ) {
        return { safe: false, reason: `符号链接指向工作目录外: ${targetPath} → ${realPath}` };
      }
    }
  } catch {
    // 文件不存在（新建场景），safe
  }
  return { safe: true };
}

// ─── 网络访问白名单 ──────────────────────────────────────

const NETWORK_WHITELIST = new Set([
  // 搜索引擎
  'html.duckduckgo.com',
  'duckduckgo.com',
  // 常用开发文档
  'raw.githubusercontent.com',
  'api.github.com',
  'registry.npmjs.org',
  'pypi.org',
  'crates.io',
  'docs.rs',
  'pkg.go.dev',
  // AI API
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
]);

/**
 * 验证 URL 是否在网络白名单中
 * 返回 safe=true 表示允许访问
 * 注意：当前仅做警告，不阻断（用于日志审计）
 */
export function validateNetworkAccess(url: string): { safe: boolean; host: string; reason?: string } {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    if (NETWORK_WHITELIST.has(host)) {
      return { safe: true, host };
    }
    // 非白名单域名 — 当前不阻断，仅标记
    return { safe: true, host, reason: `域名 ${host} 不在白名单中（已放行但已记录）` };
  } catch {
    return { safe: false, host: '', reason: `无效的 URL: ${url}` };
  }
}

// ─── 文件大小限制 ──────────────────────────────────────

/** 最大写入文件大小（10MB） */
const MAX_WRITE_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * 验证写入内容大小是否在限制范围内
 */
export function validateWriteSize(content: string): { safe: boolean; size: number; error?: string } {
  const size = Buffer.byteLength(content, 'utf-8');
  if (size > MAX_WRITE_SIZE_BYTES) {
    return {
      safe: false,
      size,
      error: `写入内容大小 ${(size / 1024 / 1024).toFixed(1)}MB 超过上限 ${MAX_WRITE_SIZE_BYTES / 1024 / 1024}MB`,
    };
  }
  return { safe: true, size };
}
