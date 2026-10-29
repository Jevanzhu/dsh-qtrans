'use strict';

/**
 * zstd frame handling for DSH session logs, plus DSH's path-key encoding.
 *
 * Session logs are *concatenated* zstd frames (one frame per append batch).
 * Node's `zlib.zstdDecompressSync` only decodes the first frame, so frames are
 * split by walking the frame format directly (no decompression needed to split).
 *
 * Encoders below are byte-for-byte ports of DSH's own implementations
 * (`projectKey` / `encodeSegment` in dsh-session-persistence-jsonl).
 */

const zlib = require('zlib');

/** Byte length of one zstd frame starting at `start`. */
function frameLength(buf, start) {
  let p = start;
  if (p + 4 > buf.length) throw new Error('truncated frame header at ' + start);
  if (buf.readUInt32LE(p) !== 0xfd2fb528) {
    throw new Error(`bad zstd magic at offset ${start}: 0x${buf.readUInt32LE(p).toString(16)}`);
  }
  p += 4;
  const fhd = buf[p++];
  const fcsFlag = fhd >> 6;
  const singleSegment = (fhd >> 5) & 1;
  const checksum = (fhd >> 2) & 1;
  const dictIdFlag = fhd & 3;
  if ((fhd >> 3) & 1) throw new Error('reserved bit set in frame header descriptor');

  if (!singleSegment) p += 1; // window descriptor
  p += [0, 1, 2, 4][dictIdFlag]; // dictionary id
  let fcsSize;
  if (fcsFlag === 0) fcsSize = singleSegment ? 1 : 0;
  else if (fcsFlag === 1) fcsSize = 2;
  else if (fcsFlag === 2) fcsSize = 4;
  else fcsSize = 8;
  p += fcsSize;

  for (;;) {
    if (p + 3 > buf.length) throw new Error('truncated block header at ' + p);
    const header = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16);
    p += 3;
    const last = header & 1;
    const type = (header >> 1) & 3;
    const size = header >>> 3;
    if (type === 0) p += size;
    else if (type === 1) p += 1;
    else if (type === 2) p += size;
    else throw new Error('reserved block type');
    if (last) break;
  }
  if (checksum) p += 4;
  if (p > buf.length) throw new Error('frame extends past end of buffer');
  return p - start;
}

/** Split a concatenated-frame buffer into individual frames. */
function splitFrames(buf) {
  const frames = [];
  let p = 0;
  while (p < buf.length) {
    const len = frameLength(buf, p);
    frames.push(buf.subarray(p, p + len));
    p += len;
  }
  return frames;
}

/** Decode every frame and concatenate the results as UTF-8 text. */
function decodeAll(buf) {
  const parts = [];
  let p = 0;
  while (p < buf.length) {
    const len = frameLength(buf, p);
    parts.push(zlib.zstdDecompressSync(buf.subarray(p, p + len)).toString('utf8'));
    p += len;
  }
  return parts.join('');
}

/** Compress one text chunk into a checksummed zstd frame (matches DSH writes). */
function compressFrame(text) {
  return zlib.zstdCompressSync(Buffer.from(text, 'utf8'), {
    params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 },
  });
}

/**
 * DSH's project directory key for a cwd.
 * Port of `projectKey` from dsh-session-persistence-jsonl.
 */
function projectKey(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw new Error('cannot encode an empty project path');
  }
  let readable = '';
  let separatorRun = false;
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-';
      separatorRun = true;
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0');
      separatorRun = false;
    }
  }
  const head = readable.replace(/^-+/, '') || 'root';
  return `--${head.slice(0, 251)}--`;
}

/** DSH's single-segment escape for session ids (port of `encodeSegment`). */
function encodeSegment(raw) {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment');
  if (raw === '.') return '~002E';
  if (raw === '..') return '~002E~002E';
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch;
    else out += '~' + code.toString(16).toUpperCase().padStart(4, '0');
  }
  return out;
}

/** Inverse of projectKey, for diagnosing/picking existing directories. */
function decodeProjectKey(name) {
  let s = name;
  if (s.startsWith('--')) s = s.slice(2);
  if (s.endsWith('--')) s = s.slice(0, -2);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '~' && /^[0-9A-Fa-f]{4}$/.test(s.slice(i + 1, i + 5))) {
      out += String.fromCharCode(parseInt(s.slice(i + 1, i + 5), 16));
      i += 4;
    } else if (s[i] === '-') out += '\\';
    else out += s[i];
  }
  return out;
}

module.exports = {
  frameLength,
  splitFrames,
  decodeAll,
  compressFrame,
  projectKey,
  encodeSegment,
  decodeProjectKey,
};
