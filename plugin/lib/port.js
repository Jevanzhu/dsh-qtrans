'use strict';

/**
 * Session port core: export / import / sync, implemented against Host services.
 *
 * Import rebinds the session to the *current* project instead of the one it was
 * recorded in: the log header's `cwd` is rewritten to the target directory and
 * the workspace registry is asked to attach the session there. That is the same
 * model as "share a conversation, then import it into a project".
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const zstd = require('./zstd.js');
const sessions = require('./session.js');
const { WebDAV } = require('./webdav.js');

function resolveHome(config) {
  const home = config.dshHome || process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return path.resolve(home.replace(/^~(?=$|[\\/])/, os.homedir()));
}

/**
 * Data directories from before the rename (`dsh-shuttle` → `dsh-qtrans`).
 * Two locations were in use — settings next to the DSH home, exports inside it —
 * so carry both over exactly once instead of starting from empty.
 */
function migrateLegacyData(config) {
  const home = resolveHome(config);
  const pairs = [
    [path.join(home, '..', '.dsh-shuttle'), path.join(home, '..', '.dsh-qtrans')],
    [path.join(home, '.dsh-shuttle'), path.join(home, '.dsh-qtrans')],
  ];
  const moved = [];
  for (const [from, to] of pairs) {
    const src = path.resolve(from);
    const dst = path.resolve(to);
    if (!fs.existsSync(src) || fs.existsSync(dst)) continue;
    try {
      fs.cpSync(src, dst, { recursive: true });
      moved.push(dst);
    } catch {
      /* migration is best-effort: a rename must never break activation */
    }
  }
  return moved;
}

function rootsOf(config) {
  const home = resolveHome(config);
  return {
    home,
    sessionsRoot: path.join(home, 'sessions'),
    attachmentsRoot: path.join(home, 'attachments'),
  };
}

function remoteOf(config) {
  const remote = config.webdav || {};
  const password = remote.passwordEnv ? process.env[remote.passwordEnv] : remote.password;
  return { url: remote.url, username: remote.username, password, prefix: remote.prefix || 'sessions' };
}

function remoteKey(remote, sessionId) {
  return `${String(remote.prefix).replace(/^\/+|\/+$/g, '')}/${sessionId}.dshsess.zip`;
}

function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

/** Every session on disk, newest first. */
function listLocal(config) {
  const { sessionsRoot } = rootsOf(config);
  if (!fs.existsSync(sessionsRoot)) return [];
  const rows = [];
  for (const project of fs.readdirSync(sessionsRoot, { withFileTypes: true })) {
    if (!project.isDirectory() || project.name.startsWith('.')) continue;
    const projectDir = path.join(sessionsRoot, project.name);
    for (const entry of fs.readdirSync(projectDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(projectDir, entry.name);
      const file = fs
        .readdirSync(dir)
        .filter((f) => /^session(\.v\d+)?\.jsonl\.zstd$/.test(f))
        .sort()
        .pop();
      if (!file) continue;
      const abs = path.join(dir, file);
      const stat = fs.statSync(abs);
      let header = null;
      try {
        header = sessions.readSessionFile(abs).header;
      } catch {
        /* unreadable logs are skipped in listings */
      }
      rows.push({
        id: entry.name,
        cwd: header && header.cwd,
        preset: header && header.agentPreset,
        file: abs,
        bytes: stat.size,
        modified: stat.mtimeMs,
      });
    }
  }
  rows.sort((a, b) => b.modified - a.modified);
  return rows;
}

/** Read one session into a bundle buffer. */
function exportBundle(ctx, config, sessionId) {
  const { sessionsRoot, attachmentsRoot } = rootsOf(config);
  const hits = sessions.findSessionDirs(sessionsRoot, sessionId);
  if (hits.length === 0) throw new Error(`本机没有会话 ${sessionId}`);
  const file = sessions.pickCurrentGeneration(hits).file;
  const session = sessions.readSessionFile(file);
  const attachments = sessions.referencedAttachments(session.text, attachmentsRoot);
  return sessions.buildBundle({
    session,
    generationFile: path.basename(file),
    records: session.records,
    attachments,
  });
}

async function flushIfLive(ctx, sessionId) {
  const live = ctx.sessions && ctx.sessions.get && ctx.sessions.get(sessionId);
  if (!live) return false;
  await ctx.sessions.flush(live);
  return true;
}

/**
 * Install a bundle into the target directory and attach it to that workspace.
 * Returns a human-readable summary.
 */
async function importBundle(ctx, config, buffer, target, options = {}) {
  const { sessionsRoot, attachmentsRoot } = rootsOf(config);
  const bundle = sessions.parseBundle(buffer);
  const sourceCwd = bundle.header.cwd;
  const newId = options.id || bundle.header.id;

  if (ctx.sessions && ctx.sessions.get && ctx.sessions.get(newId)) {
    throw new Error(`会话 ${newId} 正在本机打开，请先关闭它再导入（否则会读到内存里的旧状态）。`);
  }

  const targetDir = path.join(sessionsRoot, zstd.projectKey(target), zstd.encodeSegment(newId));
  const generation = bundle.manifest.generationFile || 'session.v4.jsonl.zstd';
  const targetFile = path.join(targetDir, generation);

  const existing = sessions.findSessionDirs(sessionsRoot, newId);
  let relation = null;
  if (fs.existsSync(targetFile)) {
    const local = sessions.readSessionFile(targetFile);
    relation = sessions.compareHistory(local.records, bundle.records);
    if (relation.relation === 'backward') {
      throw new Error(
        `本机这份比要导入的新（本机多 ${relation.localOnly} 条），远端多 ${relation.remoteOnly} 条；` +
          '看起来是方向反了。确实要回退请先删掉本机副本。'
      );
    }
    if (relation.relation === 'diverged') {
      throw new Error(
        `历史已分叉（共同前缀 ${relation.common} 条，本机多 ${relation.localOnly} 条，远端多 ${relation.remoteOnly} 条）。` +
          '同一个会话不能在两台机器上各自续写后合并。'
      );
    }
  }

  const retargeted = sessions.retarget(bundle, { cwd: target, id: options.id });
  const backupDir = path.join(resolveHome(config), '.dsh-qtrans-backup', new Date().toISOString().replace(/[:.]/g, '-'));
  if (fs.existsSync(targetDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
    fs.cpSync(targetDir, path.join(backupDir, zstd.encodeSegment(newId)), { recursive: true });
  }
  for (const hit of existing) {
    if (path.resolve(hit.dir) === path.resolve(targetDir)) continue;
    fs.mkdirSync(backupDir, { recursive: true });
    fs.cpSync(hit.dir, path.join(backupDir, 'old-' + path.basename(hit.project) + '-' + zstd.encodeSegment(newId)), {
      recursive: true,
    });
    fs.rmSync(hit.dir, { recursive: true, force: true });
  }

  sessions.writeSessionFile(targetFile, retargeted.buffer);

  for (const a of bundle.attachments) {
    const abs = path.join(attachmentsRoot, 'v1', 'objects', a.id.slice(0, 2), a.id);
    if (fs.existsSync(abs)) continue;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, a.data);
  }

  // Attach through the registry: it validates the stored cwd and owns the file.
  let attached = false;
  let attachError = null;
  try {
    const workspace = await ctx.workspaceRegistry.create(target);
    await workspace.attachSession(newId);
    await ctx.workspaceRegistry.unarchiveSession(newId);
    attached = true;
  } catch (error) {
    attachError = error instanceof Error ? error.message : String(error);
  }

  return {
    sessionId: newId,
    from: sourceCwd,
    to: target,
    file: targetFile,
    records: retargeted.records.length,
    attachments: bundle.attachments.length,
    added: relation && relation.relation === 'forward' ? relation.remoteOnly : null,
    attached,
    attachError,
    backupDir: fs.existsSync(backupDir) ? backupDir : null,
  };
}

/** Compose the one-line human summary used by every command result. */
function describeImport(result) {
  const lines = [
    `会话 ${result.sessionId} 已导入`,
    `  ${result.from || '(无源路径)'}  ->  ${result.to}`,
    `  ${result.records} 条记录，${result.attachments} 个附件` +
      (result.added ? `，接续 ${result.added} 条新内容` : ''),
  ];
  if (result.attached) lines.push('  已挂到当前项目下，可以直接继续对话');
  else lines.push(`  已写入磁盘，但登记失败: ${result.attachError || '未知原因'}`);
  if (result.backupDir) lines.push(`  备份: ${result.backupDir}`);
  return lines.join('\n');
}

async function upload(config, sessionId, buffer) {
  const remote = remoteOf(config);
  if (!remote.url) throw new Error('没有配置 webdav.url');
  const dav = new WebDAV(remote);
  const key = remoteKey(remote, sessionId);
  await dav.put(key, buffer);
  return key;
}

async function download(config, sessionId) {
  const remote = remoteOf(config);
  if (!remote.url) throw new Error('没有配置 webdav.url');
  const dav = new WebDAV(remote);
  const key = remoteKey(remote, sessionId);
  const res = await dav.get(key);
  if (!res.exists) return null;
  return { key, data: res.data };
}

module.exports = {
  resolveHome,
  migrateLegacyData,
  rootsOf,
  remoteOf,
  remoteKey,
  formatBytes,
  listLocal,
  exportBundle,
  flushIfLive,
  importBundle,
  describeImport,
  upload,
  download,
};
