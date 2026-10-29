'use strict';

/**
 * Workspace-registry helpers for the offline rename script.
 *
 *   node tools/workspace-tool.js sessions <项目路径>          # 列出该项目下的会话 id
 *   node tools/workspace-tool.js drop <项目路径> [--apply]    # 删掉指向不存在目录的空工作区
 *
 * 会话列表读的是每条日志的 header.cwd，而不是工作区登记表——目录已经改过名的
 * 情况下，登记表可能还是旧路径，只有 header 能说清一条会话真正属于谁。
 */

const fs = require('node:fs');
const path = require('node:path');

const port = require('../lib/port.js');

function norm(p) {
  return path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
}

function workspaceFile(home) {
  return path.join(home, 'storages', 'workspace.json');
}

function listSessions(target) {
  const rows = port.listLocal({});
  return rows.filter((row) => row.cwd && norm(row.cwd) === norm(target));
}

function drop(target, apply) {
  const home = port.resolveHome({});
  const file = workspaceFile(home);
  if (!fs.existsSync(file)) {
    console.error('找不到工作区注册表: ' + file);
    return 2;
  }
  const registry = JSON.parse(fs.readFileSync(file, 'utf8'));
  const tables = registry.tables && registry.tables.workspaces;
  if (!tables) {
    console.error('工作区注册表结构不认识（缺 tables.workspaces）');
    return 2;
  }

  const hits = Object.entries(tables).filter(([, w]) => w && w.path && norm(w.path) === norm(target));
  if (hits.length === 0) {
    console.log('没有指向该路径的工作区登记，无需清理。');
    return 0;
  }

  let blocked = 0;
  for (const [id, w] of hits) {
    const count = Array.isArray(w.sessionIds) ? w.sessionIds.length : 0;
    if (count > 0) {
      console.log(`跳过 ${w.title}（${id}）：还登记着 ${count} 条会话，先迁移再删。`);
      blocked++;
      continue;
    }
    console.log(`${apply ? '删除' : '将删除'}工作区 ${w.title}（${id}）路径 ${w.path}`);
    if (!apply) continue;
    delete tables[id];
    if (Array.isArray(registry.global && registry.global.workspaceIds)) {
      registry.global.workspaceIds = registry.global.workspaceIds.filter((x) => x !== id);
    }
  }

  if (apply) {
    fs.writeFileSync(file, JSON.stringify(registry, null, 2) + '\n');
    console.log('工作区注册表已更新: ' + file);
  } else if (blocked === 0) {
    console.log('\n这是预演，未改动任何文件。确认无误后加 --apply 执行。');
  }
  return blocked > 0 ? 3 : 0;
}

function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const [verb, target] = argv.filter((a) => !a.startsWith('--'));

  if (!verb || !target) {
    console.error('用法: node tools/workspace-tool.js <sessions|drop> <项目路径> [--apply]');
    process.exit(2);
  }

  if (verb === 'sessions') {
    const rows = listSessions(target);
    for (const row of rows) console.log(row.id);
    if (rows.length === 0) console.error('该项目下没有会话: ' + path.resolve(target));
    process.exit(rows.length === 0 ? 1 : 0);
  }

  if (verb === 'drop') {
    process.exit(drop(target, apply));
  }

  console.error('未知子命令: ' + verb);
  process.exit(2);
}

main();
