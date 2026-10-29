'use strict';

/**
 * Host HTTP routes for the browser half.
 *
 * The UI never touches the filesystem directly: every button calls one of these
 * routes, which run the same core as the `/qtrans` command.
 */

const fs = require('node:fs');
const path = require('node:path');

const port = require('./port.js');
const sessions = require('./session.js');

const PREFIX = '/api/qtrans';

/** `~/.dsh-qtrans/settings.json` — settings edited from the UI, overlaid on the row config. */
function settingsFile(config) {
  return path.join(port.resolveHome(config), '..', '.dsh-qtrans', 'settings.json');
}

function readSettings(config) {
  const file = settingsFile(config);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(config, patch) {
  const file = settingsFile(config);
  const next = { ...readSettings(config), ...patch };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  return next;
}

/** Effective config: row config, then UI-saved settings on top. */
function effective(config) {
  const saved = readSettings(config);
  return {
    ...config,
    ...saved,
    webdav: { ...(config.webdav || {}), ...(saved.webdav || {}) },
  };
}

/** The project a session belongs to, read from its stored header. */
function projectOfSession(config, sessionId) {
  const { sessionsRoot } = port.rootsOf(config);
  const hits = sessions.findSessionDirs(sessionsRoot, sessionId);
  if (hits.length === 0) return null;
  const header = sessions.readSessionFile(sessions.pickCurrentGeneration(hits).file).header;
  return header.cwd || null;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function fail(error, status = 500) {
  return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, status);
}

/**
 * Register every route on the Host connection carrier.
 * @param ctx Host context.
 * @param config Row config.
 */
function registerRoutes(ctx, config) {
  const connection = Reflect.get(ctx, 'connection');
  if (!connection || !connection.fetch || typeof connection.fetch.register !== 'function') {
    ctx.logger?.warn?.('dsh-qtrans: no connection.fetch carrier; browser routes unavailable');
    return;
  }

  // --- export: browser download -------------------------------------------
  connection.fetch.register({
    path: `${PREFIX}/export`,
    methods: ['GET', 'HEAD'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const url = new URL(request.url);
      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId) return new Response('missing sessionId', { status: 400 });
      try {
        await port.flushIfLive(ctx, sessionId);
        const { buffer } = port.exportBundle(ctx, effective(config), sessionId);
        const headers = {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename="dsh-session-${sessionId.replace(/[^A-Za-z0-9_-]/g, '_')}.dshsess.zip"`,
          'content-length': String(buffer.length),
        };
        if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
        return new Response(buffer, { status: 200, headers });
      } catch (error) {
        return fail(error);
      }
    },
  });

  // --- import: browser upload ---------------------------------------------
  connection.fetch.register({
    path: `${PREFIX}/import`,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const url = new URL(request.url);
      const sessionId = url.searchParams.get('sessionId');
      const cfg = effective(config);
      const target = url.searchParams.get('project') || (sessionId ? projectOfSession(cfg, sessionId) : null);
      if (!target) return json({ ok: false, error: '找不到目标项目：请带上 project，或从某个会话里发起导入' }, 400);
      try {
        const body = Buffer.from(await request.arrayBuffer());
        if (body.length === 0) return json({ ok: false, error: '上传内容为空' }, 400);
        const result = await port.importBundle(ctx, cfg, body, target);
        return json({ ok: true, result, message: port.describeImport(result) });
      } catch (error) {
        return fail(error);
      }
    },
  });

  // --- push to the other machine ------------------------------------------
  connection.fetch.register({
    path: `${PREFIX}/send`,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const sessionId = new URL(request.url).searchParams.get('sessionId');
      if (!sessionId) return json({ ok: false, error: 'missing sessionId' }, 400);
      try {
        const cfg = effective(config);
        await port.flushIfLive(ctx, sessionId);
        const { buffer } = port.exportBundle(ctx, cfg, sessionId);
        const key = await port.upload(cfg, sessionId, buffer);
        return json({ ok: true, message: `已上传到 WebDAV: ${key}` });
      } catch (error) {
        return fail(error);
      }
    },
  });

  // --- pull from the other machine ----------------------------------------
  connection.fetch.register({
    path: `${PREFIX}/recv`,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const url = new URL(request.url);
      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId) return json({ ok: false, error: 'missing sessionId' }, 400);
      try {
        const cfg = effective(config);
        const got = await port.download(cfg, sessionId);
        if (!got) return json({ ok: false, error: `远端没有 ${sessionId}` }, 404);
        const target = url.searchParams.get('project') || projectOfSession(cfg, sessionId);
        if (!target) return json({ ok: false, error: '找不到目标项目' }, 400);
        const result = await port.importBundle(ctx, cfg, got.data, target);
        return json({ ok: true, result, message: port.describeImport(result) });
      } catch (error) {
        return fail(error);
      }
    },
  });

  // --- settings -----------------------------------------------------------
  connection.fetch.register({
    path: `${PREFIX}/settings`,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const cfg = effective(config);
      if (request.method === 'GET') {
        return json({
          ok: true,
          settings: {
            webdav: {
              url: cfg.webdav?.url || '',
              username: cfg.webdav?.username || '',
              passwordEnv: cfg.webdav?.passwordEnv || '',
              prefix: cfg.webdav?.prefix || 'sessions',
            },
            outDir: path.join(port.resolveHome(cfg), '.dsh-qtrans', 'out'),
            sessionsRoot: port.rootsOf(cfg).sessionsRoot,
          },
        });
      }
      try {
        const patch = JSON.parse(await request.text());
        const saved = writeSettings(config, patch);
        return json({ ok: true, settings: saved });
      } catch (error) {
        return fail(error, 400);
      }
    },
  });

  // --- WebDAV reachability probe ------------------------------------------
  // A real round trip (MKCOL → PUT → HEAD → DELETE) rather than a bare HEAD:
  // "the host answers" and "we can actually write our bundles here" are
  // different failures, and only the second one matters.
  connection.fetch.register({
    path: `${PREFIX}/ping`,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const cfg = effective(config);
      const remote = port.remoteOf(cfg);
      if (!remote.url) return json({ ok: false, error: '还没有填 WebDAV 地址' }, 400);
      if (cfg.webdav && cfg.webdav.passwordEnv && !process.env[cfg.webdav.passwordEnv]) {
        return json({ ok: false, error: `环境变量 ${cfg.webdav.passwordEnv} 未设置` }, 400);
      }
      const started = Date.now();
      try {
        const { WebDAV } = require('./webdav.js');
        const dav = new WebDAV({
          url: remote.url,
          username: remote.username,
          password: remote.password,
          timeoutMs: 15000,
        });
        const probe = `${String(remote.prefix).replace(/^\/+|\/+$/g, '')}/.qtrans-probe`;
        await dav.put(probe, Buffer.from('dsh-qtrans probe ' + new Date().toISOString(), 'utf8'));
        const info = await dav.head(probe);
        await dav.del(probe);
        if (!info.exists) throw new Error('写入成功但读不回来（HEAD 404）');
        return json({
          ok: true,
          ms: Date.now() - started,
          prefix: remote.prefix,
          bytes: info.length,
        });
      } catch (error) {
        return json(
          {
            ok: false,
            ms: Date.now() - started,
            error: error instanceof Error ? error.message : String(error),
          },
          400
        );
      }
    },
  });

  // Self-check marker: proves the browser routes mounted on this Host process.
  try {
    const marker = path.join(port.resolveHome(config || {}), '..', '.dsh-qtrans', 'routes-mounted.json');
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(
      marker,
      JSON.stringify(
        { at: new Date().toISOString(), routes: ['export', 'import', 'send', 'recv', 'settings', 'ping'] },
        null,
        2
      ) + '\n'
    );
  } catch {
    /* a missing marker is not worth failing activation over */
  }
}

module.exports = { registerRoutes, PREFIX, readSettings, writeSettings, effective };
