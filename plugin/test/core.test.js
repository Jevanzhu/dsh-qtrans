'use strict';

/**
 * Core test for the plugin's import path, using a stub Host context.
 *
 * Verifies: bundle export from a real DSH home, import into a *different*
 * project path, header rewrite, attachment copy, and that the workspace
 * registry seam is used (create -> attachSession) rather than raw JSON edits.
 *
 * Usage: node test/core.test.js <realDshHome> <sessionId>
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const port = require('../lib/port.js');
const sessions = require('../lib/session.js');

const realHome = path.resolve(process.argv[2] || path.join(os.homedir(), '.dsh'));
const sessionId = process.argv[3];
if (!sessionId) {
  console.error('usage: node test/core.test.js <realDshHome> <sessionId>');
  process.exit(2);
}

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-qtrans-plugin-'));
const home = path.join(tmp, 'home');
const target = path.join(tmp, 'projects', 'DSH');
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(target, { recursive: true });

const config = { dshHome: home };

(async () => {
  // export from the real home (read-only)
  const { buffer, manifest } = port.exportBundle(null, { dshHome: realHome }, sessionId);
  check('导出成功', buffer.length > 0, `${manifest.records} 条记录, ${manifest.attachments.length} 个附件`);

  const attached = [];
  const ctx = {
    sessions: { get: () => undefined, flush: async () => true },
    workspaceRegistry: {
      create: async (p) => ({
        path: p,
        attachSession: async (id) => {
          if (path.resolve(p) !== path.resolve(target)) throw new Error('attached to wrong workspace');
          attached.push(id);
        },
      }),
      unarchiveSession: async () => {},
    },
  };

  const result = await port.importBundle(ctx, config, buffer, target);
  check('导入报告成功', result.attached === true, result.attachError || 'attached');
  check('走的是 registry.attachSession', attached.length === 1 && attached[0] === sessionId);

  const file = path.join(home, 'sessions', require('../lib/zstd.js').projectKey(target), sessionId, 'session.v4.jsonl.zstd');
  check('文件落在目标项目目录', fs.existsSync(file), path.relative(home, file));

  const imported = sessions.readSessionFile(file);
  check('header.cwd 改写为目标项目', imported.header.cwd === target, imported.header.cwd);
  check('记录数不变', imported.records.length === manifest.records, `${imported.records.length}`);
  check(
    '除 header 外逐条一致',
    imported.records.slice(1).join('\n') ===
      sessions.parseBundle(buffer).records.slice(1).join('\n')
  );

  // idempotent re-import (forward extension allowed without flags)
  const again = await port.importBundle(ctx, config, buffer, target);
  check('重复导入幂等', again.records === result.records && attached.length === 2);

  // a live session must be refused
  const liveCtx = { ...ctx, sessions: { get: (id) => (id === sessionId ? {} : undefined), flush: async () => true } };
  let refused = false;
  try {
    await port.importBundle(liveCtx, config, buffer, target);
  } catch (e) {
    refused = /正在本机打开/.test(e.message);
  }
  check('会话打开时拒绝导入', refused);

  console.log(`\n临时目录: ${tmp}`);
  console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('测试异常:', e);
  process.exit(1);
});
