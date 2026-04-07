/**
 * 安全防护模块
 * P1-5: 路径遍历防护 + 危险命令黑名单 + 文件大小写入上限
 */
import path from 'node:path';

// ─── 路径安全 ──────────────────────────────────────────

/**
 * 验证目标路径是否在允许的工作目录范围内
 * 防止路径遍历攻击（如 ../../etc/passwd）
 */
export function validatePath(targetPath: string, cwd: string): { safe: boolean; resolved: string; error?: string } {
  const resolved = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(cwd, targetPath);

  // 允许 cwd 本身及其子目录
  if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) {
    // 特例：允许 HOME 下的配置目录
    const home = process.env['HOME'] ?? '';
    if (home && resolved.startsWith(home + path.sep)) {
      return { safe: true, resolved };
    }
    return {
      safe: false,
      resolved,
      error: `路径越界: ${resolved} 不在工作目录 ${cwd} 范围内`,
    };
  }

  return { safe: true, resolved };
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
