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

/**
 * 检查命令是否安全
 */
export function validateCommand(command: string): { safe: boolean; reason?: string } {
  const trimmed = command.trim();

  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { safe: false, reason };
    }
  }

  return { safe: true };
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
