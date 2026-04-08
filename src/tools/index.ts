/**
 * 工具注册入口
 * 导入所有工具模块，触发 registerTool 的副作用注册
 */

// Phase 1 核心工具
import './BashTool.ts';
import './FileReadTool.ts';
import './FileWriteTool.ts';

// Phase 2 高级工具
import './FileEditTool.ts';
import './GlobTool.ts';
import './GrepTool.ts';
import './ListDirTool.ts';

// Phase 3 辅助工具
import './NoteTool.ts';

// 从注册表重新导出
export { getAllTools, getTool, getAllFunctionDefs } from '../Tool.ts';
