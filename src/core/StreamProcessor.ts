/**
 * StreamProcessor — 流式解析 + buffer 管理
 * 从 useAgentLoop 中提取，独立管理流式文本的 buffer 和 flush 逻辑
 */

export interface StreamProcessorOptions {
  /** flush 间隔 ms（默认 50ms） */
  flushIntervalMs?: number;
  /** 流式文本更新回调 */
  onFlush: (text: string) => void;
}

export class StreamProcessor {
  private buffer = '';
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private isFirstChunk = true;
  private accumulated = '';
  private readonly flushIntervalMs: number;
  private readonly onFlush: (text: string) => void;

  constructor(options: StreamProcessorOptions) {
    this.flushIntervalMs = options.flushIntervalMs ?? 50;
    this.onFlush = options.onFlush;
  }

  /**
   * 接收流式文本增量
   */
  public push(delta: string): void {
    this.buffer += delta;
    this.accumulated += delta;

    if (this.isFirstChunk) {
      // 首 chunk 立即 flush，减少首字延迟
      this.isFirstChunk = false;
      this.flush();
    } else if (!this.flushTimer) {
      // 后续 chunk 节流 flush
      this.flushTimer = setTimeout(() => {
        this.flush();
        this.flushTimer = null;
      }, this.flushIntervalMs);
    }
  }

  /**
   * 立即 flush 所有 buffer 中的内容
   */
  public flush(): void {
    if (this.buffer) {
      const chunk = this.buffer;
      this.buffer = '';
      this.onFlush(chunk);
    }
  }

  /**
   * 获取累积的完整文本
   */
  public getAccumulated(): string {
    return this.accumulated;
  }

  /**
   * 强制结束：flush 残余 + 清理定时器
   */
  public finalize(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  /**
   * 完全重置（新一轮请求前调用）
   */
  public reset(): void {
    this.finalize();
    this.buffer = '';
    this.accumulated = '';
    this.isFirstChunk = true;
  }

  /**
   * 清理定时器（组件卸载时调用）
   */
  public dispose(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
