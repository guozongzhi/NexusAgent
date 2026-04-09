import { z } from 'zod';
import { registerTool } from '../Tool.ts';
import type { ToolResult } from '../types/index.ts';

const inputSchema = z.object({
  url: z.string().describe('要抓取的 URL 地址'),
  maxLength: z.number().optional().default(20000).describe('返回内容的最大字符数'),
});

export const WebFetchTool = registerTool({
  name: 'web_fetch',
  description: '抓取指定 URL 的文本内容。支持 HTML（自动提取正文文本）、JSON、纯文本等。用于获取在线文档、API 响应、网页内容。',
  inputSchema,
  isReadOnly: true,
  authType: 'safe',
  async call(input): Promise<ToolResult> {
    const { url, maxLength } = input;

    // 基本 URL 校验
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { output: `[ERROR] 无效的 URL: ${url}`, isError: true };
    }

    // 仅允许 http/https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { output: `[ERROR] 仅支持 http/https 协议，收到: ${parsed.protocol}`, isError: true };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'NexusAgent/0.2.0 (CLI; +https://github.com/guozongzhi/NexusAgent)',
          'Accept': 'text/html,application/xhtml+xml,application/json,text/plain,*/*',
        },
        redirect: 'follow',
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return {
          output: `[ERROR] HTTP ${response.status} ${response.statusText}\nURL: ${url}`,
          isError: true,
        };
      }

      const contentType = response.headers.get('content-type') || '';
      const raw = await response.text();

      let content: string;

      if (contentType.includes('application/json')) {
        // JSON: 格式化输出
        try {
          content = JSON.stringify(JSON.parse(raw), null, 2);
        } catch {
          content = raw;
        }
      } else if (contentType.includes('text/html')) {
        // HTML: 粗略提取文本内容
        content = stripHtml(raw);
      } else {
        // 其他: 原样返回
        content = raw;
      }

      // 截断
      if (content.length > maxLength) {
        content = content.slice(0, maxLength) + `\n\n...[已截断，共 ${raw.length} 字符]`;
      }

      return {
        output: `URL: ${url}\nContent-Type: ${contentType}\n长度: ${raw.length} 字符\n\n${content}`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('abort')) {
        return { output: `[ERROR] 请求超时 (15s): ${url}`, isError: true };
      }
      return { output: `[ERROR] 网络请求失败: ${msg}`, isError: true };
    }
  },
});

/**
 * 简易 HTML 标签剥离 — 提取可读文本
 */
function stripHtml(html: string): string {
  return html
    // 移除 script/style 块
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // 移除 HTML 注释
    .replace(/<!--[\s\S]*?-->/g, '')
    // 块级标签换行
    .replace(/<\/(p|div|h[1-6]|li|tr|br|hr)[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // 移除所有标签
    .replace(/<[^>]+>/g, '')
    // 解码常见 HTML 实体
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // 清理多余空白
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
