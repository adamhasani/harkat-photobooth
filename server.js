// HARKAT Photobooth — server minimal: static serve + gallery session (QR download)
// No framework, no deps beyond stdlib. Sessions expire 24h and auto-cleanup hourly.
'use strict';
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const PUBLIC = process.env.PUBLIC_URL || null;
const UPLOAD_DIR = path.join(ROOT, 'uploads', 'sessions');
const TTL_HOURS = process.env.GALLERY_TTL_HOURS ? +process.env.GALLERY_TTL_HOURS : 24;
const PORT = +process.env.PORT || 8123;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream'
};

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  const h = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  res.writeHead(code, h);
  res.write(body);
  res.end();
}

// serve static file under ROOT (path traversal safe)
function serveStatic(res, urlPath) {
  const safe = path.normalize(urlPath).replace(/^([/\\])+/, '');
  const file = path.join(ROOT, safe);
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) {
    return json(res, 403, { error: 'forbidden' });
  }
  if (path.extname(file) === '') {
    // dir or extensionless -> index.html (SPA fallback)
    const idx = path.join(file, 'index.html');
    if (fs.existsSync(idx)) return serveStatic(res, urlPath.replace(/\/?$/, '/index.html'));
    if (fs.existsSync(path.join(file, '.html'))) return serveStatic(res, urlPath + '.html');
    return serveStatic(res, urlPath.replace(/\/?$/, '/index.html'));
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return json(res, 404, { error: 'not found' });
  }
  const data = fs.readFileSync(file);
  // heavy static (wasm/model/fonts) cacheable; html stays no-cache so fixes propagate
  const cacheable = urlPath.startsWith('/assets/') || urlPath.includes('/uploads/sessions/');
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': data.byteLength,
    'Cache-Control': cacheable ? 'public, max-age=604800' : 'no-cache'
  });
  res.write(data);
  res.end();
}

// photo dataURL from client -> jpg file (strip prefix)
function decodePhoto(dataURL) {
  const m = /^data:(image\/\w+);base64,(.+)$/.exec(dataURL);
  if (!m) return null;
  const ext = m[1] === 'image/png' ? 'png' : 'jpg';
  let buf;
  try { buf = Buffer.from(m[2], 'base64'); } catch (e) { return null; }
  return { ext, buf };
}

// public base: header X-Public-Url (Caddy per-vhost) > PUBLIC_URL env > request Host
function publicBase(req) {
  const h = req.headers['x-public-url'];
  if (h) return h.replace(/\/$/, '');
  return (PUBLIC || `http://${req.headers.host}`).replace(/\/$/, '');
}

function createSession(req, res) {
  let raw = '';
  req.on('data', (c) => raw += c);
  req.on('end', () => {
    let body;
    try { body = JSON.parse(raw); } catch (e) { return json(res, 400, { error: 'bad json' }); }
    const photos = Array.isArray(body.photos) ? body.photos : [];
    const valid = photos.map(decodePhoto).filter(Boolean);
    if (!valid.length) return json(res, 400, { error: 'no photos' });

    const now = Date.now();
    const id = crypto.randomUUID();
    const dir = path.join(UPLOAD_DIR, id);
    fs.mkdirSync(dir, { recursive: true });

    valid.forEach((p, i) => {
      fs.writeFileSync(path.join(dir, 'photo-' + (i + 1) + '.' + p.ext), p.buf);
    });
    fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({
      sessionId: id,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + TTL_HOURS * 3600e3).toISOString(),
      photos: valid.length
    }));

    const base = publicBase(req);
    json(res, 200, { ok: true, url: `${base}/gallery/${id}` });
  });
}

function galleryPage(req, res, id) {
  const dir = path.join(UPLOAD_DIR, id);
  if (!fs.existsSync(dir)) return json(res, 404, { error: 'Sesi belum ketemu / sudah expired' });
  let meta;
  try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf-8')); }
  catch (e) { return json(res, 500, { error: 'corrupt metadata' }); }
  const files = fs.readdirSync(dir).filter(f => /\.(jpe?g|png)$/i.test(f)).sort();
  const base = publicBase(req);
  const html = `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,">
<title>HARKAT — Foto Kamu</title><style>
body{font-family:system-ui,sans-serif;background:#f5eccf;color:#34221e;padding:24px;text-align:center}
h1{color:#6b1f3a;letter-spacing:2px}
.g{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));}
.g img{width:100%;border:3px solid #6b1f3a;border-radius:12px}
a{color:#3f5a7a}
small{opacity:.7}
</style></head><body>
<h1>HARKAT ✦ photo</h1>
<p>Sesi <b>${meta.sessionId.slice(0,8)}</b> — <small>${new Date(meta.expiresAt).toLocaleString()}</small></p>
<div class="g">${files.map(f => `<img src="${base}/uploads/sessions/${id}/${f}" alt="foto">`).join('\n')}</div>
<p><a href="${base}/">← Balik ke photo booth</a></p>
</body></html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html) });
  res.write(html);
  res.end();
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method === 'POST' && p === '/api/session') return createSession(req, res);
  const gal = /^\/gallery\/([0-9a-f-]+)$/.exec(p);
  if (gal) return galleryPage(req, res, gal[1]);
  return serveStatic(res, p);
});

// hour cleanup: delete expired sessions
function cleanup() {
  if (!fs.existsSync(UPLOAD_DIR)) return;
  fs.readdirSync(UPLOAD_DIR).forEach((id) => {
    const dir = path.join(UPLOAD_DIR, id);
    const metaPath = path.join(dir, 'metadata.json');
    if (!fs.existsSync(metaPath)) return;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      if (new Date(meta.expiresAt) < new Date()) {
        fs.rmSync(dir, { recursive: true, force: true });
        console.log('cleaned expired session', id);
      }
    } catch (e) { /* skip corrupt */ }
  });
}
server.listen(PORT, () => {
  console.log(`HARKAT photobooth: http://0.0.0.0:${PORT}  (gallery TTL ${TTL_HOURS}h)`);
  cleanup();
  setInterval(cleanup, 3600e3);
});