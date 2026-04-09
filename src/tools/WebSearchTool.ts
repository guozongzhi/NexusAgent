import { z } from 'zod';
import { registerTool } from '../Tool.ts';
import type { ToolResult } from '../types/index.ts';

const inputSchema = z.object({
  query: z.string().describe('搜索关键词或问题'),
});

export const WebSearchTool = registerTool({
  name: 'web_search',
  description: '在互联网上搜索信息（基于 DuckDuckGo）。当你的内部知识库缺失最新信息、遇到未知的报错或需要查阅在线文档和开源项目资讯时，使用此工具获取搜索结果。返回标题、摘要和链接。你可以进一步配合 web_fetch 抓取具体的链接内容。',
  inputSchema,
  isReadOnly: true,
  authType: 'safe',
  async call(input): Promise<ToolResult> {
    const { query } = input;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      // 请求 DuckDuckGo HTML 版
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return {
          output: `[ERROR] 搜索引擎拒绝请求 (HTTP ${response.status})。可能是遇到严格限流，请考虑直接使用 URL 获取数据。`,
          isError: true,
        };
      }

      const html = await response.text();
      
      // 简单正则提取 DuckDuckGo HTML 结果
      // DuckDuckGo 的结构：<a class="result__url" href="...">...</a>, <a class="result__snippet"...>...</a>
      const results: { title: string; link: string; snippet: string }[] = [];
      const resultBlockRegex = /<div class="result__body">([\s\S]*?)<\/div>/g;
      
      let match;
      let count = 0;
      while ((match = resultBlockRegex.exec(html)) !== null && count < 8) {
        const block = match[1];
        if (!block) continue;

        // 提取标题
        const titleMatch = /<a class="result__snippet[^>]*>([\s\S]*?)<\/a>/i.exec(block);
        const snippetRaw = (titleMatch && titleMatch[1]) ? titleMatch[1] : '';
        const snippetText = stripHtml(snippetRaw);

        // 提取链接 (通常在 result__url 组件里)
        const linkMatch = /<a class="result__url" href="([^"]+)">/i.exec(block);
        const linkRaw = (linkMatch && linkMatch[1]) ? linkMatch[1] : '';
        // DDG 的链接有可能是 /l/?uddg=... 进行跳转的，解码一下
        let realLink = linkRaw;
        if (linkRaw.includes('//duckduckgo.com/l/?uddg=')) {
          const uddgMatch = /uddg=([^&]+)/.exec(linkRaw);
          if (uddgMatch && uddgMatch[1]) {
            realLink = decodeURIComponent(uddgMatch[1]);
          }
        }

        // 提取主要标题
        const h2Match = /<h2 class="result__title">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i.exec(block);
        const titleText = (h2Match && h2Match[1]) ? stripHtml(h2Match[1]) : '';

        if (titleText && realLink) {
          results.push({
            title: titleText,
            link: realLink,
            snippet: snippetText,
          });
          count++;
        }
      }

      if (results.length === 0) {
        return {
          output: `未找到与 "${query}" 相关的搜索结果。可能是由于限流反爬，或没有相关网页。`,
        };
      }

      const outputLines = [`搜索结果：${query}`, `━━━━━━━━━━━━━━━━━━━━━━━`];
      results.forEach((r, idx) => {
        outputLines.push(`${idx + 1}. ${r.title}`);
        outputLines.push(`   URL: ${r.link}`);
        outputLines.push(`   摘要: ${r.snippet}`);
        outputLines.push('');
      });

      return {
        output: outputLines.join('\n').trim(),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('abort')) {
        return { output: `[ERROR] 搜索请求超时 (15s): ${query}`, isError: true };
      }
      return { output: `[ERROR] 网络请求失败: ${msg}`, isError: true };
    }
  },
});

function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
