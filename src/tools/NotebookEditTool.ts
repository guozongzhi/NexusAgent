import { z } from 'zod';
import { registerTool } from '../Tool.ts';
import type { ToolResult } from '../types/index.ts';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Jupyter Notebook (.ipynb) 结构化编辑工具
 * 直接操作 JSON 中的 cells 数组，避免 file_edit 的正则替换导致括号错乱
 */

const inputSchema = z.object({
  path: z.string().describe('Notebook 文件路径（相对或绝对）'),
  action: z.enum(['read', 'update_cell', 'add_cell', 'delete_cell']).describe(
    '操作类型：read 读取全部 cell; update_cell 修改指定 cell; add_cell 插入新 cell; delete_cell 删除指定 cell'
  ),
  cell_index: z.number().optional().describe('目标 cell 的索引（从 0 开始）'),
  cell_type: z.enum(['code', 'markdown', 'raw']).optional().describe('新 cell 的类型（add_cell 时必填）'),
  source: z.string().optional().describe('cell 源码内容（update_cell / add_cell 时必填）'),
});

export const NotebookEditTool = registerTool({
  name: 'notebook_edit',
  description: '结构化编辑 Jupyter Notebook (.ipynb) 文件。提供按 cell 索引的精确读写操作，避免直接编辑 JSON 而导致结构损坏。支持 read (读取所有 cell)、update_cell (修改指定 cell)、add_cell (在指定位置插入新 cell)、delete_cell (删除指定 cell)。',
  inputSchema,
  isReadOnly: false,
  authType: 'requires_confirm',
  async call(input, context): Promise<ToolResult> {
    const { action, cell_index, cell_type, source } = input;
    const filePath = path.isAbsolute(input.path) ? input.path : path.resolve(context.cwd, input.path);

    // 验证路径有效
    if (!filePath.endsWith('.ipynb')) {
      return { output: '[ERROR] 仅支持 .ipynb 文件。', isError: true };
    }

    // ── read 操作允许文件不存在时给出提示 ──
    if (action === 'read') {
      try {
        const raw = await fs.readFile(filePath, 'utf-8');
        const nb = JSON.parse(raw);
        const cells = nb.cells || [];
        const lines: string[] = [`Notebook: ${filePath}`, `Cell 数量: ${cells.length}`, ''];
        cells.forEach((cell: any, idx: number) => {
          const src = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
          const preview = src.length > 300 ? src.substring(0, 300) + '...(截断)' : src;
          lines.push(`─── Cell [${idx}] (${cell.cell_type}) ───`);
          lines.push(preview);
          // 附加输出摘要（如果有）
          if (cell.outputs && cell.outputs.length > 0) {
            lines.push(`  📤 输出: ${cell.outputs.length} 块`);
          }
          lines.push('');
        });
        return { output: lines.join('\n') };
      } catch (err: any) {
        if (err.code === 'ENOENT') return { output: `[ERROR] 文件不存在: ${filePath}`, isError: true };
        return { output: `[ERROR] 解析 Notebook 失败: ${err.message}`, isError: true };
      }
    }

    // ── 写入操作统一流程 ──
    let raw: string;
    let nb: any;
    try {
      raw = await fs.readFile(filePath, 'utf-8');
      nb = JSON.parse(raw);
    } catch (err: any) {
      if (err.code === 'ENOENT' && action === 'add_cell') {
        // 首次创建 Notebook
        nb = {
          nbformat: 4,
          nbformat_minor: 5,
          metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' } },
          cells: [],
        };
      } else {
        return { output: `[ERROR] 无法读取文件: ${err.message}`, isError: true };
      }
    }

    const cells: any[] = nb.cells || [];

    switch (action) {
      case 'update_cell': {
        if (cell_index === undefined || cell_index < 0 || cell_index >= cells.length) {
          return { output: `[ERROR] cell_index 无效。有效范围: 0 ~ ${cells.length - 1}`, isError: true };
        }
        if (!source) {
          return { output: '[ERROR] update_cell 需要提供 source 参数。', isError: true };
        }
        cells[cell_index].source = source.split('\n').map((l, i, arr) => i < arr.length - 1 ? l + '\n' : l);
        if (cell_type) {
          cells[cell_index].cell_type = cell_type;
        }
        break;
      }

      case 'add_cell': {
        if (!source) {
          return { output: '[ERROR] add_cell 需要提供 source 参数。', isError: true };
        }
        const type = cell_type || 'code';
        const newCell: any = {
          cell_type: type,
          metadata: {},
          source: source.split('\n').map((l, i, arr) => i < arr.length - 1 ? l + '\n' : l),
        };
        if (type === 'code') {
          newCell.execution_count = null;
          newCell.outputs = [];
        }
        const insertAt = cell_index !== undefined ? Math.min(cell_index, cells.length) : cells.length;
        cells.splice(insertAt, 0, newCell);
        break;
      }

      case 'delete_cell': {
        if (cell_index === undefined || cell_index < 0 || cell_index >= cells.length) {
          return { output: `[ERROR] cell_index 无效。有效范围: 0 ~ ${cells.length - 1}`, isError: true };
        }
        cells.splice(cell_index, 1);
        break;
      }
    }

    nb.cells = cells;
    await fs.writeFile(filePath, JSON.stringify(nb, null, 1), 'utf-8');

    return {
      output: `✅ ${action} 成功。当前 cell 数: ${cells.length}`,
    };
  },
});
