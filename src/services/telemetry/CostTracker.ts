import fs from 'fs';
import path from 'path';
import os from 'os';

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface CostRecord {
  timestamp: string;
  model: string;
  usage: TokenUsage;
  costUsd: number;
}

export interface CostSummary {
  totalUsd: number;
  models: Record<string, number>;
  totalTokens: number;
}

// 计费模型字典（每百万 Token 的 USD 单价）
const PRICING_TABLE: Record<string, { prompt: number; completion: number }> = {
  'gpt-4o': { prompt: 5.0, completion: 15.0 },
  'gpt-4o-mini': { prompt: 0.15, completion: 0.6 },
  'claude-3-5-sonnet-20241022': { prompt: 3.0, completion: 15.0 },
  'claude-3-5-haiku-20241022': { prompt: 0.8, completion: 4.0 },
};

function getCostDbPath(): string {
  return path.join(os.homedir(), '.nexus', 'cost_db.json');
}

export class CostTracker {
  private records: CostRecord[] = [];
  private dbPath: string;

  constructor() {
    this.dbPath = getCostDbPath();
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.dbPath)) {
        const data = fs.readFileSync(this.dbPath, 'utf8');
        this.records = JSON.parse(data) || [];
      }
    } catch (e) {
      this.records = [];
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.dbPath, JSON.stringify(this.records, null, 2), 'utf8');
    } catch (e) {
      // 忽略写入错误
    }
  }

  public recordUsage(model: string, usage: TokenUsage): CostRecord {
    let cost = 0;
    const rates = PRICING_TABLE[model];
    if (rates) {
      cost = (usage.promptTokens / 1_000_000) * rates.prompt + 
             (usage.completionTokens / 1_000_000) * rates.completion;
    }

    const record: CostRecord = {
      timestamp: new Date().toISOString(),
      model,
      usage,
      costUsd: cost,
    };

    this.records.push(record);
    this.save();
    return record;
  }

  public getSummary(): CostSummary {
    let totalUsd = 0;
    let totalTokens = 0;
    const models: Record<string, number> = {};

    for (const r of this.records) {
      totalUsd += r.costUsd;
      totalTokens += r.usage.totalTokens;
      models[r.model] = (models[r.model] || 0) + r.costUsd;
    }

    return { totalUsd, models, totalTokens };
  }

  public clear(): void {
    this.records = [];
    this.save();
  }
}

// 导出单例实例
export const costTracker = new CostTracker();
