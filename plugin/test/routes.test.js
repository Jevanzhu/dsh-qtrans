'use strict';

/**
 * Route-level test: register the Host routes on a stub connection, then call the
 * handlers with real Request objects. Verifies the browser half's contract
 * without restarting DSH.
 *
 * Usage: node test/routes.test.js <realDshHome> <sessionId>
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { registerRoutes } = require('../lib/routes.js');
const sessions = require('../lib/session.js');
const zstd = require('../lib/zstd.js');

const realHome = path.resolve(process.argv[2] || path.join(os.homedir(), '.dsh'));
const sessionId = process.argv[3];
if (!sessionId) {
  console.error('usage: node test/routes.test.js <realDshHome> <sessionId>');
  process.exit(2);
}

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-routes-'));
const home = path.join(tmp, 'home');
const project = path.join(tmp, 'projects', 'DSH');
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(project, { recursive: true });

const routes = [];
const ctx = {
  logger: { warn: () => {} },
  connection: { fetch: { register: (route) => routes.push(route) } },
  sessions: { get: () => undefined, flush: async () => true },
  workspaceRegistry: {
    create: async () => ({ attachSession: async () => {} }),
    unarchiveSession: async () => {},
  },
};

function find(suffix) {
  const route = routes.find((r) => r.path.endsWith(suffix));
  if (!route) throw new Error('route not registered: ' + suffix);
  return route;
}

(async () => {
  // real home for export, temp home for everything written
  registerRoutes(ctx, { dshHome: home, webdav: {} });
  check('注册了 6 条路由', routes.length === 6, routes.map((r) => r.path).join(', '));

  // --- export --------------------------------------------------------------
  const exportRoute = find('/export');
  const exportCtx = { ...ctx, connection: ctx.connection };
  // export must read from the real home, so re-register with that config
  routes.length = 0;
  registerRoutes(exportCtx, { dshHome: realHome, webdav: {} });
  const ex = find('/export');

  const headRes = await ex.fetch(new Request(`http://x/api/qtrans/export?sessionId=${sessionId}`, { method: 'HEAD' }));
  check('HEAD 导出返回 200', headRes.status === 200, 'content-length=' + headRes.headers.get('content-length'));
  check('带下载文件名', /attachment; filename="dsh-session-/.test(headRes.headers.get('content-disposition') || ''));

  const getRes = await ex.fetch(new Request(`http://x/api/qtrans/export?sessionId=${sessionId}`));
  const buf = Buffer.from(await getRes.arrayBuffer());
  check('GET 导出返回 zip', getRes.status === 200 && buf.length > 0, buf.length + ' B');
  let parsed = null;
  try {
    parsed = sessions.parseBundle(buf);
  } catch (error) {
    check('zip 可解析', false, error.message);
  }
  if (parsed) check('zip 可解析', parsed.header.id === sessionId, parsed.records.length + ' 条记录');

  const missing = await ex.fetch(new Request('http://x/api/qtrans/export'));
  check('缺 sessionId 返回 400', missing.status === 400);

  // --- import --------------------------------------------------------------
  routes.length = 0;
  registerRoutes(ctx, { dshHome: home, webdav: {} });
  const im = find('/import');
  const importRes = await im.fetch(
    new Request(`http://x/api/qtrans/import?project=${encodeURIComponent(project)}`, {
      method: 'POST',
      body: buf,
    })
  );
  const importBody = await importRes.json();
  check('导入返回 200', importRes.status === 200 && importBody.ok === true, importBody.message && importBody.message.split('\n')[0]);
  const landed = path.join(home, 'sessions', zstd.projectKey(project), sessionId, 'session.v4.jsonl.zstd');
  check('文件落到目标项目', fs.existsSync(landed), path.relative(home, landed));
  if (fs.existsSync(landed)) {
    check('cwd 已改写', sessions.readSessionFile(landed).header.cwd === project);
  }

  const noProject = await im.fetch(new Request('http://x/api/qtrans/import', { method: 'POST', body: buf }));
  check('缺目标项目返回 400', noProject.status === 400);

  // --- settings ------------------------------------------------------------
  const st = find('/settings');
  const before = await (await st.fetch(new Request('http://x/api/qtrans/settings'))).json();
  check('设置 GET 返回结构', before.ok === true && typeof before.settings.sessionsRoot === 'string', before.settings.sessionsRoot);

  const saveRes = await st.fetch(
    new Request('http://x/api/qtrans/settings', {
      method: 'POST',
      body: JSON.stringify({ webdav: { url: 'https://dav.example.com/x/', username: 'me', passwordEnv: 'DSH_WEBDAV_PASSWORD' } }),
    })
  );
  const saved = await saveRes.json();
  check('设置 POST 保存成功', saveRes.status === 200 && saved.ok === true);
  const settingsPath = path.join(home, '..', '.dsh-qtrans', 'settings.json');
  check('设置写进 settings.json', fs.existsSync(settingsPath), settingsPath);
  const after = await (await st.fetch(new Request('http://x/api/qtrans/settings'))).json();
  check('设置回读一致', after.settings.webdav.url === 'https://dav.example.com/x/', after.settings.webdav.url);

  console.log(`\n临时目录: ${tmp}`);
  console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.error('测试异常:', error);
  process.exit(1);
});
