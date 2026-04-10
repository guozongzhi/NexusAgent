import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export interface SnapshotRecord {
  id: string;
  timestamp: number;
  files: {
    originalPath: string;
    backupPath: string | null; // null means file didn't exist originally (should be deleted on undo)
  }[];
}

const MAX_SNAPSHOTS = 10;

export class FileVault {
  private static instance: FileVault;
  private vaultDir: string;
  private dbPath: string;
  private records: SnapshotRecord[] = [];

  private constructor() {
    this.vaultDir = path.join(os.homedir(), '.nexus', 'backups');
    this.dbPath = path.join(this.vaultDir, 'journal.json');
  }

  public static async getInstance(): Promise<FileVault> {
    if (!FileVault.instance) {
      FileVault.instance = new FileVault();
      await FileVault.instance.init();
    }
    return FileVault.instance;
  }

  private async init() {
    await fs.mkdir(this.vaultDir, { recursive: true });
    try {
      const data = await fs.readFile(this.dbPath, 'utf-8');
      this.records = JSON.parse(data) || [];
    } catch {
      this.records = [];
    }
  }

  private async saveJournal() {
    await fs.writeFile(this.dbPath, JSON.stringify(this.records, null, 2), 'utf-8');
  }

  /**
   * 清理过期快照（LRU机制）
   */
  private async cleanOldSnapshots() {
    if (this.records.length <= MAX_SNAPSHOTS) return;
    
    // Sort by timestamp descending
    this.records.sort((a, b) => b.timestamp - a.timestamp);
    const toKeep = this.records.slice(0, MAX_SNAPSHOTS);
    const toDelete = this.records.slice(MAX_SNAPSHOTS);
    
    this.records = toKeep;
    await this.saveJournal();

    // 物理删除老旧快照目录
    for (const record of toDelete) {
      const recordDir = path.join(this.vaultDir, record.id);
      try {
        await fs.rm(recordDir, { recursive: true, force: true });
      } catch (err) {
        // ignore delete errors on cleanup
      }
    }
  }

  /**
   * 为即将被修改的文件创建只读快照
   */
  public async createSnapshot(filePaths: string[]): Promise<string> {
    const id = crypto.randomUUID();
    const snapshotDir = path.join(this.vaultDir, id);
    await fs.mkdir(snapshotDir, { recursive: true });

    const record: SnapshotRecord = {
      id,
      timestamp: Date.now(),
      files: [],
    };

    for (const originalPath of filePaths) {
      try {
        const stat = await fs.stat(originalPath);
        if (stat.isFile()) {
           // 文件存在，备份它
           // 生成该文件的散列命名防止名字冲突
           const safeName = crypto.createHash('md5').update(originalPath).digest('hex') + path.extname(originalPath);
           const backupPath = path.join(snapshotDir, safeName);
           await fs.copyFile(originalPath, backupPath);
           record.files.push({ originalPath, backupPath });
        }
      } catch (err: any) {
        if (err.code === 'ENOENT') {
           // 文件原本不存在（即将被写入的新文件），记录 null
           record.files.push({ originalPath, backupPath: null });
        }
      }
    }

    if (record.files.length > 0) {
      this.records.push(record);
      await this.saveJournal();
      // 触发后台清理
      this.cleanOldSnapshots().catch(() => {});
    }

    return id;
  }

  /**
   * 恢复最新的一条快照，相当于一键 Undo
   */
  public async restoreLastSnapshot(): Promise<{ success: boolean; message: string }> {
    if (this.records.length === 0) {
      return { success: false, message: '当前没有任何可供回滚的快照。' };
    }

    // 弹出最近的快照
    this.records.sort((a, b) => a.timestamp - b.timestamp);
    const lastRecord = this.records.pop()!;

    let restoredCount = 0;
    let deletedCount = 0;
    let failedCount = 0;

    for (const file of lastRecord.files) {
      try {
        if (file.backupPath) {
          // 复原原文件
          await fs.copyFile(file.backupPath, file.originalPath);
          restoredCount++;
        } else {
          // 原本不存在，此时应删除新写出的文件
          await fs.unlink(file.originalPath).catch(() => {});
          deletedCount++;
        }
      } catch (err) {
        failedCount++;
      }
    }

    await this.saveJournal();

    let msg = `已撤销上一次的修改。\n恢复了 ${restoredCount} 个文件`;
    if (deletedCount > 0) msg += `，删除了 ${deletedCount} 个刚创建的文件`;
    if (failedCount > 0) msg += `，其中 ${failedCount} 个文件恢复发生异常`;
    msg += `。`;

    return { success: failedCount === 0, message: msg };
  }
}
