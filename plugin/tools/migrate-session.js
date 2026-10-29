'use strict';

/**
 * 把一条会话迁到另一个项目（工作区）下。
 *
 * 为什么必须离线跑：会话日志是追加写的，DSH 运行时对目标文件持有写句柄。
 * 在会话还活着的时候改写它的 header 并移动文件，会让后续追加写到旧路径，
 * 直接撕裂日志。所以本脚本要求 DSH 完全退出后再执行（--apply）。
 *
 * 用法：
 *   node tools/migrate-session.js <sessionId> <目标项目绝对路径>            # 预演，只打印
 *   node tools/migrate-session.js <sessionId> <目标项目绝对路径> --apply    # 真正执行
 *
 * 做四件事：
 *   1. 读旧日志，把 header.cwd 及带路径的事件改写成目标项目
 *   2. 写到目标项目 key 下的会话目录
 *   3. 旧文件备份到 <home>/.dsh-qtrans-backup/<时间戳>/ 后删除
 *   4. workspace.json：确保目标工作区存在，把会话 id 从别处移进去
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const sessions = require('../lib/session.js');
const zstd = require('../lib/zstd.js');

function home() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

function norm(p) {
  return path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
}

function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const [sessionId, targetRaw] = argv.filter((a) => !a.startsWith('--'));

  if (!sessionId || !targetRaw) {
    console.error('用法: node tools/migrate-session.js <sessionId> <目标项目绝对路径> [--apply]');
    process.exit(2);
  }

  const target = path.resolve(targetRaw);
  if (!fs.existsSync(target)) {
    console.error(`目标项目不存在: ${target}`);
    process.exit(2);
  }
  if (!fs.statSync(target).isDirectory()) {
    console.error(`目标不是目录: ${target}`);
    process.exit(2);
  }

  const root = home();
  const sessionsRoot = path.join(root, 'sessions');
  const workspaceFile = path.join(root, 'storages', 'workspace.json');

  // --- 1. 找到会话 --------------------------------------------------------
  const hits = sessions.findSessionDirs(sessionsRoot, sessionId);
  if (hits.length === 0) {
    console.error(`找不到会话 ${sessionId}（在 ${sessionsRoot} 下）`);
    process.exit(1);
  }
  const current = sessions.pickCurrentGeneration(hits);
  const file = sessions.readSessionFile(current.file);
  const oldCwd = file.header.cwd;

  console.log('=== 迁移计划 ===');
  console.log(`会话        ${sessionId}`);
  console.log(`记录数      ${file.records.length}`);
  console.log(`原项目      ${oldCwd}`);
  console.log(`目标项目    ${target}`);
  console.log(`源文件      ${current.file}`);

  if (norm(oldCwd) === norm(target)) {
    console.log('\n会话已经在目标项目下，无需迁移。');
    process.exit(0);
  }

  const targetDir = path.join(sessionsRoot, zstd.projectKey(target), zstd.encodeSegment(sessionId));
  const targetFile = path.join(targetDir, path.basename(current.file));
  console.log(`目标文件    ${targetFile}`);

  // --- 2. 工作区计划 ------------------------------------------------------
  if (!fs.existsSync(workspaceFile)) {
    console.error(`找不到工作区注册表: ${workspaceFile}`);
    process.exit(1);
  }
  const registry = JSON.parse(fs.readFileSync(workspaceFile, 'utf8'));
  const tables = registry.tables && registry.tables.workspaces;
  if (!tables) {
    console.error('工作区注册表结构不认识（缺 tables.workspaces）');
    process.exit(1);
  }
  const entries = Object.entries(tables);
  const found = entries.find(([, w]) => norm(w.path) === norm(target));
  const holders = entries.filter(([, w]) => Array.isArray(w.sessionIds) && w.sessionIds.includes(sessionId));

  console.log(`目标工作区  ${found ? `已存在 ${found[0]}（${found[1].title}）` : '不存在，将新建'}`);
  console.log(`当前归属    ${holders.length === 0 ? '未登记在任何工作区' : holders.map(([id, w]) => `${w.title}(${id})`).join(', ')}`);

  if (!apply) {
    console.log('\n这是预演，未改动任何文件。确认无误后加 --apply 执行。');
    return;
  }

  // --- 3. 备份并搬文件 ----------------------------------------------------
  const backupDir = path.join(root, '.dsh-qtrans-backup', stamp());
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, path.basename(current.file));
  fs.copyFileSync(current.file, backupFile);
  console.log(`\n已备份      ${backupFile}`);

  const retargeted = sessions.retarget(file, { cwd: target });
  sessions.writeSessionFile(targetFile, retargeted.buffer);
  console.log(`已写入      ${targetFile}`);

  // 只有一份旧副本时直接删；多份（不同 project key 下重复）一并清掉
  const removed = [];
  for (const hit of hits) {
    if (norm(hit.file) === norm(targetFile)) continue;
    fs.rmSync(hit.file, { force: true });
    removed.push(hit.file);
  }
  fs.copyFileSync(backupFile, path.join(backupDir, 'source-original.zstd'));
  console.log(`已删除旧件  ${removed.length} 个`);

  // --- 4. 改工作区注册表 --------------------------------------------------
  fs.copyFileSync(workspaceFile, path.join(backupDir, 'workspace.json'));
  // workspace.json 的 createdAt/updatedAt 是 ISO-8601 字符串（zod z.string()），
  // 写毫秒数会让 DSH 启动时校验整张表失败，整个会话列表都加载不出来。
  const now = new Date().toISOString();
  let workspaceId;
  if (found) {
    workspaceId = found[0];
  } else {
    workspaceId = crypto.randomUUID();
    tables[workspaceId] = {
      path: target,
      title: path.basename(target),
      sessionIds: [],
      createdAt: now,
      updatedAt: now,
    };
    if (Array.isArray(registry.global?.workspaceIds)) registry.global.workspaceIds.push(workspaceId);
    console.log(`已新建工作区 ${workspaceId}（${path.basename(target)}）`);
  }

  for (const [, w] of Object.entries(tables)) {
    if (Array.isArray(w.sessionIds)) {
      w.sessionIds = w.sessionIds.filter((id) => id !== sessionId);
    }
  }
  const ws = tables[workspaceId];
  ws.sessionIds = [sessionId, ...(ws.sessionIds || [])];
  ws.updatedAt = now;

  fs.writeFileSync(workspaceFile, JSON.stringify(registry, null, 2) + '\n');
  console.log(`已登记到工作区 ${ws.title}`);

  console.log(`\n完成。备份目录: ${backupDir}`);
  console.log('启动 DSH 后，这条会话会出现在目标工作区里。');
}

main();
