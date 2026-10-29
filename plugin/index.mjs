import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const port = require('./lib/port.js');
const sessions = require('./lib/session.js');
const { registerRoutes } = require('./lib/routes.js');

export const name = 'dsh-qtrans';

/** Host services this plugin cannot work without. */
export const inject = ['commands', 'connection', 'workspaceRegistry', 'workingDirectory', 'sessions'];

const USAGE = [
  '/qtrans list — 列出本机会话',
  '/qtrans export <会话id> — 打包到 ~/.dsh-qtrans/out/',
  '/qtrans import <bundle.zip> — 导入到当前项目',
  '/qtrans send <会话id> — 打包并上传到 WebDAV',
  '/qtrans recv <会话id> — 从 WebDAV 下载并导入到当前项目',
  '/qtrans sync [会话id] — 谁新听谁的（日常接力用这个）',
].join('\n');

/** The project this conversation belongs to: the import lands here. */
async function currentProject(ctx, invocation) {
  const dir = await ctx.workingDirectory.ensure(invocation.agent, invocation.signal);
  if (!dir) throw new Error('拿不到当前会话的项目目录');
  return path.resolve(dir);
}

function outDir(config) {
  const home = port.resolveHome(config);
  return path.join(home, '.dsh-qtrans', 'out');
}

async function runList(config, invocation) {
  const rows = port.listLocal(config);
  if (rows.length === 0) return { kind: 'success', text: '本机没有会话。' };

  let project = null;
  try {
    project = await currentProject(ctxRef, invocation);
  } catch {
    /* listing still works without a current project */
  }
  const shown = project ? rows.filter((r) => r.cwd && path.resolve(r.cwd) === project) : rows;
  const scope = project ? `当前项目（${project}）` : '全部项目';
  if (shown.length === 0) return { kind: 'success', text: `${scope}下没有会话。` };

  const lines = [`${scope} 共 ${shown.length} 个会话:`, ''];
  for (const r of shown.slice(0, 20)) {
    const when = new Date(r.modified).toISOString().slice(0, 16).replace('T', ' ');
    lines.push(`${r.id}`);
    lines.push(`  ${r.cwd || '(无 cwd)'}  ${port.formatBytes(r.bytes)}  ${when}`);
  }
  if (shown.length > 20) lines.push(`… 还有 ${shown.length - 20} 个`);
  return { kind: 'success', text: lines.join('\n') };
}

async function runExport(config, invocation, sessionId) {
  if (!sessionId) throw new Error('用法: /qtrans export <会话id>');
  const flushed = await port.flushIfLive(ctxRef, sessionId);
  const { buffer, manifest } = port.exportBundle(ctxRef, config, sessionId);
  const dir = outDir(config);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.dshsess.zip`);
  fs.writeFileSync(file, buffer);
  return {
    kind: 'success',
    text: [
      `已导出 ${manifest.session.id}`,
      `  ${manifest.records} 条记录，${manifest.attachments.length} 个附件，${port.formatBytes(buffer.length)}`,
      `  ${file}`,
      flushed ? '  （导出前已把内存中的最新事件刷到磁盘）' : '',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

async function runImport(config, invocation, bundlePath) {
  if (!bundlePath) throw new Error('用法: /qtrans import <bundle.zip>');
  const file = path.resolve(bundlePath.replace(/^~(?=$|[\\/])/, process.env.USERPROFILE || process.env.HOME || ''));
  if (!fs.existsSync(file)) throw new Error('找不到文件: ' + file);
  const target = await currentProject(ctxRef, invocation);
  const result = await port.importBundle(ctxRef, config, fs.readFileSync(file), target);
  return { kind: 'success', text: port.describeImport(result) };
}

async function runSend(config, invocation, sessionId) {
  if (!sessionId) throw new Error('用法: /qtrans send <会话id>');
  await port.flushIfLive(ctxRef, sessionId);
  const { buffer } = port.exportBundle(ctxRef, config, sessionId);
  const key = await port.upload(config, sessionId, buffer);
  return { kind: 'success', text: `已上传到 WebDAV: ${key}\n在另一台机器上执行: /qtrans recv ${sessionId}` };
}

async function runRecv(config, invocation, sessionId) {
  if (!sessionId) throw new Error('用法: /qtrans recv <会话id>');
  const got = await port.download(config, sessionId);
  if (!got) throw new Error(`远端没有 ${sessionId}`);
  const target = await currentProject(ctxRef, invocation);
  const result = await port.importBundle(ctxRef, config, got.data, target);
  return { kind: 'success', text: port.describeImport(result) };
}

async function runSync(config, invocation, sessionId) {
  const rows = port.listLocal(config);
  if (!sessionId) {
    const target = await currentProject(ctxRef, invocation);
    const mine = rows.filter((r) => r.cwd && path.resolve(r.cwd) === target);
    if (mine.length === 0) throw new Error('当前项目下没有会话，先用 /qtrans import 或 /qtrans recv');
    sessionId = mine[0].id;
  }

  const local = rows.find((r) => r.id === sessionId) || null;
  const got = await port.download(config, sessionId);

  if (!local && !got) throw new Error(`本机和远端都没有会话 ${sessionId}`);
  if (!got) return runSend(config, invocation, sessionId);
  if (!local) return runRecv(config, invocation, sessionId);

  const localRecords = sessions.readSessionFile(local.file).records;
  const remoteRecords = sessions.parseBundle(got.data).records;
  const rel = sessions.compareHistory(localRecords, remoteRecords);

  if (rel.relation === 'equal') {
    return { kind: 'success', text: `两端一致（${localRecords.length} 条记录），无需操作。` };
  }
  if (rel.relation === 'backward') {
    await port.flushIfLive(ctxRef, sessionId);
    const { buffer } = port.exportBundle(ctxRef, config, sessionId);
    const key = await port.upload(config, sessionId, buffer);
    return { kind: 'success', text: `本机领先 ${rel.localOnly} 条，已上传到 ${key}` };
  }
  if (rel.relation === 'forward') {
    const result = await port.importBundle(ctxRef, config, got.data, path.resolve(local.cwd || (await currentProject(ctxRef, invocation))));
    return { kind: 'success', text: `远端领先 ${rel.remoteOnly} 条，已下载\n\n` + port.describeImport(result) };
  }
  throw new Error(
    `历史已分叉（共同前缀 ${rel.common} 条，本机多 ${rel.localOnly} 条，远端多 ${rel.remoteOnly} 条）。\n` +
      '同一个会话不能在两台机器上各自续写后再合并，请手工决定保留哪一边。'
  );
}

let ctxRef = null;

export function apply(ctx, config) {
  ctxRef = ctx;
  const settings = config || {};

  // Carry the pre-rename data over once; after this everything lives under `qtrans`.
  try {
    const moved = port.migrateLegacyData(settings);
    if (moved.length > 0) ctx.logger?.info?.(`dsh-qtrans: 旧数据目录已迁移 → ${moved.join(', ')}`);
  } catch {
    /* diagnostics must never take activation down */
  }

  ctx.effect(() =>
    ctx.commands.register({
      name: 'qtrans',
      description: '跨机器搬运本会话/其他会话：导出、导入、WebDAV 上传下载',
      input: { hint: 'list | export <id> | import <zip> | send <id> | recv <id> | sync [id]' },
      handler: async (invocation) => {
        const raw = String(invocation.rawInput || '').trim();
        const [sub, ...rest] = raw.split(/\s+/).filter(Boolean);
        const arg = rest[0];
        try {
          switch (sub) {
            case 'list':
              return await runList(settings, invocation);
            case 'export':
              return await runExport(settings, invocation, arg);
            case 'import':
              return await runImport(settings, invocation, arg);
            case 'send':
              return await runSend(settings, invocation, arg);
            case 'recv':
              return await runRecv(settings, invocation, arg);
            case 'sync':
              return await runSync(settings, invocation, arg);
            case undefined:
            case '':
            case 'help':
              return { kind: 'success', text: USAGE };
            default:
              return { kind: 'error', text: `未知子命令 "${sub}"\n\n${USAGE}` };
          }
        } catch (error) {
          return { kind: 'error', text: error instanceof Error ? error.message : String(error) };
        }
      },
    })
  );

  // Browser half: every button in the UI calls one of these routes.
  // Failing to mount routes must never take the whole plugin down: the /qtrans
  // command half has to stay usable.
  try {
    registerRoutes(ctx, settings);
  } catch (error) {
    const text = error instanceof Error ? (error.stack || error.message) : String(error);
    console.warn('dsh-qtrans: 浏览器路由注册失败，命令仍可用 —', text);
    try {
      const file = path.join(port.resolveHome(settings), '..', '.dsh-qtrans', 'routes-error.txt');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text + '\n');
    } catch {
      /* diagnostics must never mask the original failure */
    }
  }
}
