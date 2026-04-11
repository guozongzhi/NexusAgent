import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';

export interface BackgroundJob {
  jobId: string;
  pid: number | undefined;
  command: string;
  cwd: string;
  status: 'running' | 'exited' | 'error';
  exitCode: number | null;
  logs: string[];
  startTime: number;
}

const MAX_LOG_LINES = 1000;

export class JobManager {
  private static instance: JobManager;
  private jobs: Map<string, { job: BackgroundJob; proc: ChildProcess }> = new Map();
  private subscribers: Set<() => void> = new Set();

  private constructor() {
    // 监听进程退出，斩杀所有后台子进程
    process.on('exit', () => {
      for (const { proc } of this.jobs.values()) {
        try {
          proc.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
    });
  }

  public static getInstance(): JobManager {
    if (!JobManager.instance) {
      JobManager.instance = new JobManager();
    }
    return JobManager.instance;
  }

  private notify() {
    for (const listener of this.subscribers) {
      listener();
    }
  }

  public subscribe(listener: () => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  /**
   * 启动挂起的后台守护进程
   */
  public spawnJob(command: string, cwd: string, env: typeof process.env): string {
    const jobId = crypto.randomUUID().split('-')[0]!;
    
    const proc = spawn('bash', ['-c', command], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const jobInfo: BackgroundJob = {
      jobId,
      pid: proc.pid,
      command,
      cwd,
      status: 'running',
      exitCode: null,
      logs: [],
      startTime: Date.now(),
    };

    this.jobs.set(jobId, { job: jobInfo, proc });
    this.notify();

    const appendLog = (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      const lines = text.split('\n');
      
      // RingBuffer logic
      jobInfo.logs.push(...lines);
      if (jobInfo.logs.length > MAX_LOG_LINES) {
        jobInfo.logs = jobInfo.logs.slice(-MAX_LOG_LINES);
      }
    };

    proc.stdout.on('data', appendLog);
    proc.stderr.on('data', appendLog);

    proc.on('close', (code) => {
      jobInfo.status = 'exited';
      jobInfo.exitCode = code;
      jobInfo.logs.push(`[Process Exited with code ${code}]`);
      this.notify();
    });

    proc.on('error', (err) => {
      jobInfo.status = 'error';
      jobInfo.logs.push(`[Process Error: ${err.message}]`);
      this.notify();
    });

    return jobId;
  }

  public getJobs(): BackgroundJob[] {
    return Array.from(this.jobs.values()).map(j => j.job);
  }

  public getActiveJobCount(): number {
    return Array.from(this.jobs.values()).filter(j => j.job.status === 'running').length;
  }

  public getJobLogs(jobId: string, lines: number = 200): string | null {
    const record = this.jobs.get(jobId);
    if (!record) return null;
    const { job } = record;
    return job.logs.slice(-lines).join('\n') || '(no output yet)';
  }

  public writeStdin(jobId: string, input: string): boolean {
    const record = this.jobs.get(jobId);
    if (!record || record.job.status !== 'running') return false;
    
    // 如果没有自带回车，按常规 CLI 交互自动补偿回车
    const normalizedInput = input.endsWith('\n') ? input : input + '\n';
    return record.proc.stdin?.write(normalizedInput) ?? false;
  }

  public killJob(jobId: string): boolean {
    const record = this.jobs.get(jobId);
    if (!record || record.job.status !== 'running') return false;
    
    record.proc.kill('SIGTERM');
    // 如果不退出则 1 秒后 SIGKILL
    setTimeout(() => {
      if (record.job.status === 'running') {
         try { record.proc.kill('SIGKILL'); } catch {}
      }
    }, 1000);
    return true;
  }
}
