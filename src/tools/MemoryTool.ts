import { z } from 'zod';
import { registerTool } from '../Tool.ts';
import { getRelevantMemories, addMemory, removeMemory } from '../services/memory/memoryStore.ts';

export const MemoryTool = registerTool({
  name: 'memory',
  description: 'Manage L2 persistent memories. Use this tool to read, add, or remove memories. Global memories persist across all projects (e.g. user preferences like "Use dark mode"). Workspace memories persist only in the current project (e.g. "Run npm start to dev", "Project uses Next.js"). Add memories when the user explicitly asks you to remember something, or when you discover an important project-specific technical constraint that you should not forget.',
  authType: 'requires_confirm',
  isReadOnly: false,
  inputSchema: z.object({
    action: z.enum(['read', 'add', 'remove']).describe('The action to perform on the memory store.'),
    scope: z.enum(['global', 'workspace']).describe('The scope of the memory.'),
    content: z.string().optional().describe('The fact or preference to remember. E.g. "User prefers explicit TypeScript returns". Required for "add".'),
    id: z.string().optional().describe('The UUID of the memory to remove. Required for "remove".')
  }),

  async call(args, _context) {
    const { action, scope, content, id } = args;
    const cwd = process.cwd();

    switch (action) {
      case 'read': {
        const ptrs = await getRelevantMemories(cwd);
        // getRelevantMemories 会加载全局(*)和当前 cwd 的
        // 返回匹配 scope 的
        const filtered = ptrs.filter(p => (scope === 'global' ? p.cwd === '*' : p.cwd !== '*'));
        if (filtered.length === 0) return { output: `No ${scope} memories found.` };
        return { output: `[${scope.toUpperCase()} MEMORIES]\n` + filtered.map(p => `- [id:${p.id}] ${p.snippet}`).join('\n') };
      }

      case 'add': {
        if (!content) return { output: 'Error: content is required for adding a memory.', isError: true };
        const isGlobal = scope === 'global';
        const newMem = await addMemory(cwd, content, isGlobal);
        return { output: `Memory successfully saved to ${scope} scope with ID: ${newMem.id}` };
      }

      case 'remove': {
        if (!id) return { output: 'Error: memory id is required for removing.', isError: true };
        const success = await removeMemory(id);
        return { output: success ? `Memory [${id}] successfully removed.` : `Error: Memory [${id}] not found in ${scope} scope.`, isError: !success };
      }

      default:
        return { output: `Error: Unknown action ${action}`, isError: true };
    }
  }
});
