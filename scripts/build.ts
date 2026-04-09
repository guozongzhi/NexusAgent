#!/usr/bin/env bun
/**
 * Nexus Agent — 构建脚本
 * 使用 Bun 的 compile 能力将项目打包成独立的可执行二进制
 *
 * 用法: bun run scripts/build.ts
 * 产物: dist/nexus-{platform}-{arch}
 */
import { $ } from 'bun';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dir, '..');
const DIST = path.join(ROOT, 'dist');
const ENTRY = path.join(ROOT, 'src', 'main.tsx');

async function main() {
  console.log('🔨 Nexus Agent Build Pipeline');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // 1. 预检
  console.log('  ✓ 运行类型检查...');
  await $`bun run typecheck`.cwd(ROOT);

  console.log('  ✓ 运行测试...');
  await $`bun test`.cwd(ROOT);

  // 2. 清理产物目录
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(DIST, { recursive: true });

  // 3. 编译
  const platform = os.platform();
  const arch = os.arch();
  const outputName = `nexus-${platform}-${arch}`;
  const outputPath = path.join(DIST, outputName);

  console.log(`  ✓ 编译目标: ${outputName}`);
  console.log(`  ✓ 入口: ${ENTRY}`);

  await $`bun build --compile ${ENTRY} --outfile ${outputPath}`.cwd(ROOT);

  // 4. 验证产物
  const stat = await fs.stat(outputPath);
  const sizeMB = (stat.size / 1024 / 1024).toFixed(2);

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ 构建成功！`);
  console.log(`   产物: ${outputPath}`);
  console.log(`   大小: ${sizeMB} MB`);
  console.log('');
  console.log(`运行: ./${path.relative(ROOT, outputPath)}`);
}

main().catch(err => {
  console.error('❌ 构建失败:', err.message);
  process.exit(1);
});
