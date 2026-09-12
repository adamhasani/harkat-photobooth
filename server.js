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
    // direct html file check (e.g. /ai -> /ai.html)
    const directHtml = file + '.html';
    if (fs.existsSync(directHtml) && fs.statSync(directHtml).isFile()) {
      return serveStatic(res, urlPath + '.html');
    }
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

const GROQ_KEYS = [
  'REDACTED_GROQ_KEY',
  'REDACTED_GROQ_KEY',
  'REDACTED_GROQ_KEY'
];
let groqKeyIdx = 0;

const SYSTEM_PROMPT = `Kamu adalah sistem AI Computer Vision & Biometric Analyzer presisi tinggi untuk booth Sains Data & AI UKM EXPO UHN.
Tugasmu: Analisis foto wajah pengunjung dengan SANGAT TELITI, OBJEKTIF, dan AKURAT untuk mendeteksi GENDER (Laki-laki vs Perempuan), USIA, CIRI FISIK NYATA, dan KEMBARAN TOKOH.

PANDUAN KLASIFIKASI GENDER (SANGAT KRUSIAL - JANGAN SALAH):
1. Periksa ciri maskulin vs feminin secara seksama:
   - Ciri Laki-laki: Struktur alis alami/tebal tanpa pensil alis, tidak menggunakan riasan wajah/lipstik/eyeliner/mascara, proporsi garis rahang/dagu pria, garis leher/jakun/bahu pria, postur pria. Meskipun berwajah bersih/tanpa jenggot/kulit mulus/babyface dan rambut pendek, jika tidak memakai makeup wanita dan berpakaian kemeja/kaos pria, itu adalah LAKI-LAKI.
   - Ciri Perempuan: Riasan wajah (eyeshadow, pensil alis, lipstick/gloss), bentuk bibir feminin dengan riasan, perhiasan anting wanita, pakaian/kerah wanita, gaya rambut wanita.
   - JANGAN mengira pria muda berkulit bersih/rambut pendek sebagai perempuan!

2. Tokoh mirip (lookalike) WAJIB 100% SESUAI GENDER:
   - Jika Laki-laki: Tokoh pria yang berkarisma & relevan (misal: Nicholas Saputra, Reza Rahadian, Iqbaal Ramadhan, B.J. Habibie, Keanu Reeves, Elon Musk, Dikta, Jerome Polin, Raditya Dika, Tulus, dll).
   - Jika Perempuan: Tokoh wanita yang berprestasi (misal: Maudy Ayunda, Chelsea Islan, Dian Sastro, Isyana Sarasvati, Taylor Swift, Najwa Shihab, Sri Mulyani, Lisa Blackpink, dll).

3. Panduan Estimasi Umur (17-30 tahun):
   - Maba / Young (18-19): Kulit kencang, babyface, tanpa garis halus dahi/mata.
   - Mahasiswa Aktif (20-22): Garis senyum dinamis, kulit elastis & segar.
   - Senior / Alumni Muda (23-26): Sedikit garis ekspresi halus di sudut mata/dahi.
   - Dewasa Matang (27-30+): Lipatan nasolabial lebih dalam atau garis dahi jelas.

Kembalikan HANYA format JSON murni tanpa markdown:
{
  "gender": "<Laki-laki 👦 / Perempuan 👧>",
  "age": <integer umur realistis 17-30>,
  "generation": "<Gen-Z Fresh 🎓 / Gen-Z Tech Wizard 💻 / Creative Soul 🎨 / Young Achiever 🌟>",
  "beautyScore": <skor pesona 88-99 integer>,
  "symmetryScore": <skor simetri 88-99 integer>,
  "wrinkleAnalysis": "<Analisis tekstur kulit & kerutan>",
  "lookalike": "<Nama Tokoh sesuai gender>",
  "lookalikeRole": "<Profesi/julukan tokoh>",
  "lookalikeMatch": <persen 86-98 integer>,
  "majorVibe": "<misal: Sains Data & AI / Sistem Informasi / Teknik Informatika / Bisnis Digital>",
  "comment": "<1-2 kalimat analisis unik menyebut ciri fisik nyata & pakaian di foto>",
  "facialTraits": "<3 ciri fisik terdeteksi, pisahkan koma>"
}`;

async function callGroqVision(photo, telemetry) {
  let telemetryText = 'Analisis biometrik wajah ini secara spesifik & akurat untuk booth Sains Data AI UKM EXPO UHN:';
  if (telemetry) {
    telemetryText = `Data Pengukuran Sensor Biometrik MediaPipe 3D:
- Simetri Wajah Terukur: ${telemetry.symmetryPct || 95}%
- Intensitas Senyuman: ${telemetry.smilePct || 80}%

Tugasmu: Tentukan gender pengunjung secara independen dari pengamatan visual nyata foto (rambut, pakaian, wajah, riasan) dan gabungkan dengan data sensor 3D ini:`;
  }

  const payload = JSON.stringify({
    model: 'qwen/qwen3.8-27b',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: telemetryText },
          { type: 'image_url', image_url: { url: photo } }
        ]
      }
    ],
    max_completion_tokens: 350,
    temperature: 0.2
  });

  const https = require('https');
  const totalKeys = GROQ_KEYS.length;

  for (let i = 0; i < totalKeys; i++) {
    const key = GROQ_KEYS[(groqKeyIdx + i) % totalKeys];
    const res = await new Promise((resolve) => {
      const req = https.request({
        hostname: 'api.groq.com',
        path: '/openai/v1/chat/completions',
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + key,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 6000
      }, (resp) => {
        let raw = '';
        resp.on('data', d => raw += d);
        resp.on('end', () => {
          if (resp.statusCode === 200) {
            try {
              const parsed = JSON.parse(raw);
              const content = parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content;
              if (content) {
                const m = /\{[\s\S]*\}/.exec(content);
                if (m) {
                  groqKeyIdx = (groqKeyIdx + i + 1) % totalKeys;
                  return resolve(JSON.parse(m[0]));
                }
              }
            } catch (e) {}
          }
          resolve(null);
        });
      });

      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.write(payload);
      req.end();
    });

    if (res) return res;
  }
  return null;
}

async function analyzeFaceWithAi(req, res) {
  let raw = '';
  req.on('data', (c) => raw += c);
  req.on('end', async () => {
    let body;
    try { body = JSON.parse(raw); } catch (e) { return json(res, 400, { error: 'bad json' }); }
    const photo = String(body.photo || '');
    const telemetry = body.telemetry || null;
    if (!photo.startsWith('data:image/')) {
      return json(res, 400, { error: 'photo dataURL required' });
    }

    const aiData = await callGroqVision(photo, telemetry);
    if (aiData) {
      return json(res, 200, { ok: true, provider: 'groq', ai: aiData, data: aiData });
    }
    return json(res, 200, { fallback: true });
  });
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
    json(res, 200, { ok: true, id, url: `${base}/gallery/${id}` });
  });
}

// store rendered sheet PNG into session dir (from /api/sheet)
function saveSheet(req, res) {
  let raw = '';
  req.on('data', (c) => raw += c);
  req.on('end', () => {
    let body;
    try { body = JSON.parse(raw); } catch (e) { return json(res, 400, { error: 'bad json' }); }
    const dir = path.join(UPLOAD_DIR, String(body.sessionId || ''));
    const id = path.basename(String(body.sessionId || ''));
    if (!/^[0-9a-f-]{36}$/.test(id) || !fs.existsSync(dir)) {
      return json(res, 404, { error: 'sesi tidak ketemu' });
    }
    const p = decodePhoto(String(body.png || ''));
    if (!p || p.ext !== 'png') return json(res, 400, { error: 'png required' });
    fs.writeFileSync(path.join(dir, 'sheet.png'), p.buf);
    json(res, 200, { ok: true });
  });
}

// QR target: sheet.png langsung unduh; fallback redirect ke galeri
function downloadSheet(req, res, id) {
  const dir = path.join(UPLOAD_DIR, id);
  const sheet = path.join(dir, 'sheet.png');
  if (fs.existsSync(sheet)) {
    const data = fs.readFileSync(sheet);
    res.writeHead(200, {
      'Content-Type': MIME['.png'],
      'Content-Length': data.byteLength,
      'Content-Disposition': `attachment; filename="ukmexpo-foto-${id.slice(0, 8)}.png"`
    });
    res.write(data);
    res.end();
    return;
  }
  // belum ada sheet -> galeri biasa
  res.writeHead(302, { Location: `/gallery/${id}` });
  res.end();
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
<title>UKM EXPO UHN — Foto Kamu</title><style>
body{font-family:system-ui,sans-serif;background:#f5eccf;color:#34221e;padding:24px;text-align:center}
h1{color:#6b1f3a;letter-spacing:2px}
.g{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));}
.g img{width:100%;border:3px solid #6b1f3a;border-radius:12px}
a{color:#3f5a7a}
small{opacity:.7}
</style></head><body>
<h1>UKM EXPO UHN ✦ photo</h1>
<p>Sesi <b>${meta.sessionId.slice(0,8)}</b> — <small>${new Date(meta.expiresAt).toLocaleString()}</small></p>
<div class="g">${files.map(f => `<a download href="${base}/uploads/sessions/${id}/${f}" title="Unduh ${f}"><img src="${base}/uploads/sessions/${id}/${f}" alt="foto"></a>`).join('\n')}</div>
<p><b>Tip:</b> tap/klik foto atas untuk unduh langsung — <a href="${base}/download/${id}">atau unduh sheet PNG (1 file)</a>.</p>
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
  if (req.method === 'POST' && p === '/api/sheet') return saveSheet(req, res);
  if (req.method === 'POST' && p === '/api/ai-analyze') return analyzeFaceWithAi(req, res);
  const dl = /^\/download\/([0-9a-f-]+)$/.exec(p);
  if (dl) return downloadSheet(req, res, dl[1]);
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