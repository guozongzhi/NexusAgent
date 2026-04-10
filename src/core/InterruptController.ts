/**
 * InterruptController — 中断/取消管理
 * 管理 AbortController 生命周期，支持优雅中断和强制中断
 */

export class InterruptController {
  private controller: AbortController | null = null;
  private _isInterrupted = false;

  /**
   * 创建新的中断控制器（每次 LLM 请求前调用）
   */
  public create(): AbortController {
    this.controller = new AbortController();
    this._isInterrupted = false;
    return this.controller;
  }

  /**
   * 获取当前的 abort signal
   */
  public get signal(): AbortSignal | undefined {
    return this.controller?.signal;
  }

  /**
   * 是否处于中断状态
   */
  public get isInterrupted(): boolean {
    return this._isInterrupted;
  }

  /**
   * 是否有活跃的控制器
   */
  public get isActive(): boolean {
    return this.controller !== null && !this.controller.signal.aborted;
  }

  /**
   * 执行中断
   */
  public abort(): void {
    if (this.controller && !this.controller.signal.aborted) {
      this._isInterrupted = true;
      this.controller.abort();
    }
  }

  /**
   * 重置状态（LLM 请求结束后调用）
   */
  public reset(): void {
    this.controller = null;
    this._isInterrupted = false;
  }
}
