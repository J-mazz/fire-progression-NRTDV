#!/usr/bin/env node
// Local authoring + static server. Serves dist/ and exposes GET/PUT /api/config
// so the in-app Settings form can write public/data/catalog.config.json and
// regenerate the catalog. Dev-only: production (static Pages) has no equivalent.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { validateDraft, mergeConfig } = require('./config_merge');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const CONFIG = path.join(ROOT, 'public', 'data', 'catalog.config.json');
const DIST_CATALOG = path.join(DIST, 'data', 'catalog.json');
const GENERATOR = path.join(ROOT, 'tools', 'generate_catalog.js');
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
const MAX_BODY_BYTES = 512 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.kml': 'application/vnd.google-earth.kml+xml', '.wasm': 'application/wasm',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.splat': 'application/octet-stream'
};

// Regenerate from a staged config first: if the generator rejects the draft,
// both the config and the served catalog are left exactly as they were.
function writeConfig(draft) {
  const existing = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  const config = mergeConfig(existing, draft);
  const staged = `${CONFIG}.next`;
  fs.writeFileSync(staged, `${JSON.stringify(config, null, 2)}\n`);
  try {
    execFileSync('node', [GENERATOR, staged, DIST_CATALOG], { stdio: 'ignore' });
  } catch (error) {
    fs.rmSync(staged, { force: true });
    throw error;
  }
  fs.renameSync(staged, CONFIG);
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(payload);
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const resolved = path.resolve(DIST, relative);
  // path.sep suffix guards against `..` escapes AND sibling dirs sharing the prefix (dist-x).
  if (resolved !== DIST && !resolved.startsWith(DIST + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(resolved, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(resolved)] ?? 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0];

  if (url === '/api/config' && req.method === 'GET') {
    fs.readFile(CONFIG, (error, data) => {
      if (error) return sendJson(res, 500, { error: 'Config not found.' });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(data);
    });
    return;
  }

  if (url === '/api/config' && req.method === 'PUT') {
    const chunks = [];
    let size = 0;
    let oversized = false;
    req.on('data', (chunk) => {
      if (oversized) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // Answer before hanging up; a bare destroy() leaves the client waiting.
        oversized = true;
        sendJson(res, 413, { error: 'Config payload exceeds 512 KiB.' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (oversized) return;
      let draft;
      try {
        draft = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return sendJson(res, 400, { error: 'Invalid JSON body.' });
      }
      const invalid = validateDraft(draft);
      if (invalid) return sendJson(res, 422, { error: invalid });
      try {
        writeConfig(draft);
      } catch (error) {
        return sendJson(res, 500, { error: `Failed to write config: ${error.message}` });
      }
      sendJson(res, 200, { ok: true });
    });
    return;
  }

  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'text/plain' }).end('Method not allowed');
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`wildfire-NRTDV dev server on http://${HOST}:${PORT} (config authoring enabled)`);
});
