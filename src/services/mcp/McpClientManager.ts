import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ToolResult } from '../../types/index.ts';

export interface McpServerDef {
  name: string;
  command: string;
  args: string[];
}

export interface McpToolWrapper {
  serverName: string;
  toolName: string;
  description: string;
  inputSchema: any;
}

export class McpClientManager {
  private clients = new Map<string, Client>();
  private transports = new Map<string, StdioClientTransport>();

  /**
   * 启动并连接单个 MCP 服务器
   */
  public async connectServer(def: McpServerDef): Promise<void> {
    if (this.clients.has(def.name)) {
      return; // 已连接
    }

    try {
      const transport = new StdioClientTransport({
        command: def.command,
        args: def.args,
        // 这里可以通过 env: process.env 继承环境变量
        env: { ...process.env, PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin' },
      });

      const client = new Client(
        {
          name: 'nexus-agent-client',
          version: '0.1.0',
        },
        {
          capabilities: {},
        }
      );

      await client.connect(transport);
      
      this.transports.set(def.name, transport);
      this.clients.set(def.name, client);
      
    } catch (err) {
      console.error(`[MCP] Failed to connect to server ${def.name}:`, err);
    }
  }

  /**
   * 批量启动所有 MCP 服务器
   */
  public async connectAll(servers: Record<string, { command: string, args: string[] }>): Promise<void> {
    const promises = Object.entries(servers).map(([name, conf]) => 
      this.connectServer({ name, command: conf.command, args: conf.args })
    );
    await Promise.allSettled(promises);
  }

  /**
   * 从所有已连接的服务器中获取工具列表
   */
  public async getAllTools(): Promise<McpToolWrapper[]> {
    const allTools: McpToolWrapper[] = [];
    
    for (const [serverName, client] of this.clients.entries()) {
      try {
        const res = await client.listTools();
        for (const tool of res.tools) {
          allTools.push({
            serverName,
            toolName: tool.name,
            description: tool.description || `Tool ${tool.name} from ${serverName}`,
            inputSchema: tool.inputSchema,
          });
        }
      } catch (err) {
        console.error(`[MCP] Failed to fetch tools from ${serverName}:`, err);
      }
    }
    
    return allTools;
  }

  /**
   * 路由代理：调用特定的 MCP 工具
   */
  public async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    const client = this.clients.get(serverName);
    if (!client) {
      return { output: `[ERROR] MCP Server ${serverName} is not connected.`, isError: true };
    }

    try {
      const result = await client.callTool({
        name: toolName,
        arguments: args,
      });

      // 组装文本返回值
      const content = (result as any).content || [];
      const textOutput = content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');
      
      return {
        output: textOutput || '(Empty output from MCP Server)',
        isError: Boolean((result as any).isError),
      };
    } catch (err) {
      return { output: `[ERROR] MCP Tool execution failed: ${err}`, isError: true };
    }
  }

  /**
   * 优雅退出
   */
  public async closeAll(): Promise<void> {
    for (const [name, transport] of this.transports.entries()) {
      try {
        await transport.close();
      } catch (e) {
        // ignore
      }
    }
    this.clients.clear();
    this.transports.clear();
  }
}

// 全局单例
export const mcpManager = new McpClientManager();
