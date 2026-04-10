import { useState, useEffect } from 'react';

export interface Tip {
  id: string;
  text: string;
  highlight?: string;
}

const COMMAND_HINTS: Record<string, string> = {
  '/m': 'ℹ /memory (知识库), /model (切换模型), /mcp (工具扩展)',
  '/c': 'ℹ /cost (查看开销), /commit (提交代码), /clear (清除对话)',
  '/h': 'ℹ /help (查看帮助), /history (历史信息)',
  '/s': 'ℹ /status (系统状态), /skills (技能流), /sk',
};

const KEYWORD_HINTS = [
  { match: /git|commit|提交/, tip: '使用 /commit 命令可以自动提取 Git 差异并附带暂存功能。' },
  { match: /cost|多少钱|计费|token/, tip: '你可以随时键入 /cost 呼出全局计费统计账单。' },
  { match: /忘|全忘了|记不住/, tip: '键入 /memory learn 提取工程根目录的全局图谱至本地持久化数据库。' },
  { match: /太长了|上下文超限|上限/, tip: '试一试 /compact 命令直接在客户端裁剪陈旧的上下文数据。' },
  { match: /插件|mcp/, tip: '使用 /mcp add 可以热拔插挂载任何社区的 MCP 组件库！' }
];

export function useProactiveTips(inputValue: string): Tip | null {
  const [activeTip, setActiveTip] = useState<Tip | null>(null);

  useEffect(() => {
    const text = inputValue.trim();

    if (!text) {
      setActiveTip(null);
      return;
    }

    // 1. 命令即时前缀提示 (快速按键探测)
    if (text.startsWith('/')) {
      const match = Object.keys(COMMAND_HINTS).find(prefix => text === prefix);
      if (match) {
        setActiveTip({ id: 'cmd-' + match, text: COMMAND_HINTS[match]! });
        return;
      }
    }

    // 2. 文本语义关键词推测提示 (防抖检测，虽然实现简单，但有效)
    if (!text.startsWith('/')) {
      const lower = text.toLowerCase();
      const matchedKeyword = KEYWORD_HINTS.find(k => k.match.test(lower));
      if (matchedKeyword) {
        setActiveTip({ id: 'kw-' + matchedKeyword.match.toString(), text: 'ℹ 提示: ' + matchedKeyword.tip });
        return;
      }
    }

    setActiveTip(null);
  }, [inputValue]);

  return activeTip;
}
