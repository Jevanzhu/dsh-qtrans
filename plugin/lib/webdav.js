'use strict';

/**
 * Tiny WebDAV client: GET / PUT / HEAD / MKCOL / DELETE over http(s) with
 * Basic auth. Only what a file sync needs; no PROPFIND (the file list is known).
 */

const http = require('http');
const https = require('https');

function encodePath(p) {
  return p
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

class WebDAV {
  constructor({ url, username, password, timeoutMs = 30000 }) {
    if (!url) throw new Error('缺少 WebDAV url');
    this.base = url.endsWith('/') ? url : url + '/';
    this.auth =
      username !== undefined && username !== null
        ? 'Basic ' + Buffer.from(`${username}:${password || ''}`, 'utf8').toString('base64')
        : null;
    this.timeoutMs = timeoutMs;
  }

  request(method, relPath, body) {
    const target = new URL(encodePath(relPath), this.base);
    const mod = target.protocol === 'https:' ? https : http;
    const headers = {};
    if (this.auth) headers.Authorization = this.auth;
    if (body) headers['Content-Length'] = body.length;

    return new Promise((resolve, reject) => {
      const req = mod.request(
        target,
        { method, headers, timeout: this.timeoutMs },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () =>
            resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })
          );
        }
      );
      req.on('timeout', () => req.destroy(new Error(`WebDAV ${method} ${relPath} 超时`)));
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }

  async get(relPath) {
    const res = await this.request('GET', relPath);
    if (res.status === 404) return { exists: false, data: null };
    if (res.status >= 200 && res.status < 300) return { exists: true, data: res.body };
    throw new Error(`GET ${relPath} -> HTTP ${res.status}`);
  }

  async put(relPath, data) {
    await this.ensureCollections(relPath);
    const res = await this.request('PUT', relPath, data);
    if (res.status < 200 || res.status >= 300) throw new Error(`PUT ${relPath} -> HTTP ${res.status}`);
    return res.status;
  }

  async head(relPath) {
    const res = await this.request('HEAD', relPath);
    if (res.status === 404) return { exists: false };
    if (res.status >= 200 && res.status < 300) {
      return { exists: true, length: Number(res.headers['content-length'] || 0) };
    }
    throw new Error(`HEAD ${relPath} -> HTTP ${res.status}`);
  }

  async del(relPath) {
    const res = await this.request('DELETE', relPath);
    if (res.status === 404) return false;
    if (res.status < 200 || res.status >= 300) throw new Error(`DELETE ${relPath} -> HTTP ${res.status}`);
    return true;
  }

  /** MKCOL every missing parent collection (405/301 mean it already exists). */
  async ensureCollections(relPath) {
    const segments = relPath.split('/').filter(Boolean);
    segments.pop();
    let prefix = '';
    for (const seg of segments) {
      prefix += seg + '/';
      const res = await this.request('MKCOL', prefix);
      if (res.status >= 200 && res.status < 300) continue;
      if ([301, 405, 409].includes(res.status)) continue;
      throw new Error(`MKCOL ${prefix} -> HTTP ${res.status}`);
    }
  }
}

module.exports = { WebDAV, encodePath };
