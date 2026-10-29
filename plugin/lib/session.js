'use strict';

/**
 * Session log reading/writing, attachment discovery, and bundle assembly.
 *
 * A session lives at:
 *   <root>/<projectKey(cwd)>/<encodeSegment(id)>/session.vN.jsonl.zstd
 * The log is append-only concatenated zstd frames; the first record is the
 * `session` header, and it is the only place the project cwd is recorded.
 */

const fs = require('fs');
const path = require('path');
const zstd = require('./zstd');
const { writeZip, readZip } = require('./zip');

const BUNDLE_FORMAT = 'dsh-session-bundle';
const BUNDLE_VERSION = 1;

function readJsonl(text) {
  const lines = text.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const records = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    records.push(line);
  }
  return records;
}

/** Read one session log file into its decoded form. */
function readSessionFile(file) {
  const buf = fs.readFileSync(file);
  const frames = zstd.splitFrames(buf);
  const text = zstd.decodeAll(buf);
  const records = readJsonl(text);
  if (records.length === 0) throw new Error('session log has no records: ' + file);
  const header = JSON.parse(records[0]);
  if (header.type !== 'session') throw new Error('first record is not a session header: ' + file);
  return { file, frames, text, records, header };
}

/** Locate every on-disk copy of a session id under the sessions root. */
function findSessionDirs(root, sessionId) {
  const hits = [];
  if (!fs.existsSync(root)) return hits;
  for (const project of fs.readdirSync(root, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const projectDir = path.join(root, project.name);
    let entries;
    try {
      entries = fs.readdirSync(projectDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name !== sessionId && zstd.encodeSegment(entry.name) !== zstd.encodeSegment(sessionId)) {
        continue;
      }
      const dir = path.join(projectDir, entry.name);
      const files = fs.readdirSync(dir).filter((f) => /^session(\.v\d+)?\.jsonl\.zstd$/.test(f));
      for (const f of files) hits.push({ dir, project: project.name, file: path.join(dir, f) });
    }
  }
  return hits;
}

/** Pick the highest generation file among candidates. */
function pickCurrentGeneration(hits) {
  const score = (f) => {
    const m = /^session\.v(\d+)\.jsonl\.zstd$/.exec(path.basename(f));
    if (m) return Number(m[1]);
    return 0; // `session.jsonl.zstd` is released v0
  };
  return hits.slice().sort((a, b) => score(b.file) - score(a.file))[0];
}

const ATTACHMENT_RE = /[0-9a-f]{64}/g;

/** Attachment object ids referenced by the session text that exist locally. */
function referencedAttachments(text, attachmentsRoot) {
  const ids = new Set();
  for (const m of text.matchAll(ATTACHMENT_RE)) ids.add(m[0]);
  const found = [];
  for (const id of ids) {
    const rel = path.join('v1', 'objects', id.slice(0, 2), id);
    const abs = path.join(attachmentsRoot, rel);
    if (fs.existsSync(abs)) found.push({ id, rel, abs });
  }
  return found;
}

/** Build a portable bundle buffer for one session. */
function buildBundle({ session, generationFile, records, attachments, archived, pinned, projectMap }) {
  const header = session.header;
  const manifest = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    exporter: 'dsh-qtrans/3.0',
    session: {
      id: header.id,
      cwd: header.cwd,
      createdAt: header.createdAt,
      agentPreset: header.agentPreset,
      formatVersion: header.version,
    },
    generationFile,
    records: records.length,
    attachments: attachments.map((a) => a.id),
    archived: Boolean(archived),
    pinned: Boolean(pinned),
    projectMap: projectMap || undefined,
  };

  const entries = [
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8') },
    { name: 'session.jsonl', data: Buffer.from(records.join('\n') + '\n', 'utf8') },
  ];
  for (const a of attachments) {
    entries.push({ name: 'attachments/' + a.id, data: fs.readFileSync(a.abs) });
  }
  return { buffer: writeZip(entries), manifest };
}

/** Parse a bundle buffer back into its parts. */
function parseBundle(buffer) {
  const files = readZip(buffer);
  const manifestRaw = files.get('manifest.json');
  if (!manifestRaw) throw new Error('bundle is missing manifest.json');
  const manifest = JSON.parse(manifestRaw.toString('utf8'));
  if (manifest.format !== BUNDLE_FORMAT) {
    throw new Error(`not a ${BUNDLE_FORMAT} archive (format=${manifest.format})`);
  }
  if (manifest.version > BUNDLE_VERSION) {
    throw new Error(`bundle version ${manifest.version} is newer than this tool supports (${BUNDLE_VERSION})`);
  }
  const sessionRaw = files.get('session.jsonl');
  if (!sessionRaw) throw new Error('bundle is missing session.jsonl');
  const records = readJsonl(sessionRaw.toString('utf8'));
  if (records.length === 0) throw new Error('bundle session.jsonl is empty');
  const header = JSON.parse(records[0]);
  if (header.type !== 'session') throw new Error('bundle session.jsonl does not start with a session header');

  const attachments = [];
  for (const [name, data] of files) {
    if (!name.startsWith('attachments/')) continue;
    const id = name.slice('attachments/'.length);
    if (!/^[0-9a-f]{64}$/.test(id)) continue;
    attachments.push({ id, data });
  }
  return { manifest, records, header, attachments };
}

/**
 * Rewrite the header cwd (and any working-directory style record that names the
 * old path) and serialise the log as a fresh file: header frame + body frame.
 */
function retarget({ records, header }, { cwd, id }) {
  const nextHeader = { ...header, cwd };
  if (id) nextHeader.id = id;
  const out = [JSON.stringify(nextHeader)];
  const oldCwd = header.cwd;

  for (let i = 1; i < records.length; i++) {
    const line = records[i];
    if (!oldCwd || !line.includes(JSON.stringify(oldCwd).slice(1, -1))) {
      out.push(line);
      continue;
    }
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      out.push(line);
      continue;
    }
    const type = String(rec.type || '');
    if (!/working[-_]?directory|cwd/i.test(type)) {
      out.push(line);
      continue;
    }
    out.push(JSON.stringify(rewriteStrings(rec, oldCwd, cwd)));
  }

  const headerLine = out[0] + '\n';
  const body = out.slice(1).map((l) => l + '\n').join('');
  const frames = [zstd.compressFrame(headerLine)];
  if (body) frames.push(zstd.compressFrame(body));
  return { buffer: Buffer.concat(frames), header: nextHeader, records: out };
}

function rewriteStrings(value, from, to) {
  if (typeof value === 'string') {
    if (!value.includes(from)) return value;
    return value.split(from).join(to);
  }
  if (Array.isArray(value)) return value.map((v) => rewriteStrings(v, from, to));
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = rewriteStrings(value[k], from, to);
    return out;
  }
  return value;
}

/** Write a session log atomically (temp file + rename). */
function writeSessionFile(file, buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, file);
}

/**
 * Compare two versions of the same session by their event history.
 *
 * DSH logs are append-only and committed events are never rewritten, so the
 * only legitimate difference between two copies is "one is a prefix of the
 * other". That makes the direction decidable without trusting mtimes (which
 * WebDAV and cloud drives do not preserve reliably).
 *
 * Index 0 (the header) is skipped: its `cwd` differs by design across machines.
 *
 * @returns {{relation: 'equal'|'forward'|'backward'|'diverged', localOnly: number, remoteOnly: number, common: number}}
 */
function compareHistory(localRecords, remoteRecords) {
  const a = localRecords.slice(1);
  const b = remoteRecords.slice(1);
  const limit = Math.min(a.length, b.length);
  let common = 0;
  while (common < limit && a[common] === b[common]) common++;
  const localOnly = a.length - common;
  const remoteOnly = b.length - common;

  if (common === a.length && common === b.length) {
    return { relation: 'equal', localOnly: 0, remoteOnly: 0, common };
  }
  if (common === a.length) {
    // every local event is in the remote copy: remote is ahead
    return { relation: 'forward', localOnly, remoteOnly, common };
  }
  if (common === b.length) {
    // every remote event is in the local copy: local is ahead
    return { relation: 'backward', localOnly, remoteOnly, common };
  }
  return { relation: 'diverged', localOnly, remoteOnly, common };
}

module.exports = {
  BUNDLE_FORMAT,
  BUNDLE_VERSION,
  readJsonl,
  readSessionFile,
  findSessionDirs,
  pickCurrentGeneration,
  referencedAttachments,
  buildBundle,
  parseBundle,
  retarget,
  writeSessionFile,
  compareHistory,
};
