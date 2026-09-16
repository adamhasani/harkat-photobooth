// HARKAT Photobooth — server minimal: static serve + gallery session (QR download)
// No framework, no deps beyond stdlib. Sessions expire 24h and auto-cleanup hourly.
'use strict';
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { findBestLookalike, CELEBS_DATABASE_1000, matchCelebByKeywords } = require('./assets/data/celebs_database.js');
const { analyzeFaceWithAiDev } = require('./ai_accuracy_engine.js');

const ROOT = __dirname;
const PUBLIC = process.env.PUBLIC_URL || null;
const UPLOAD_DIR = path.join(ROOT, 'uploads', 'sessions');
const CELEB_CACHE_DIR = path.join(ROOT, 'assets', 'celebs_cache');
if (!fs.existsSync(CELEB_CACHE_DIR)) {
  try { fs.mkdirSync(CELEB_CACHE_DIR, { recursive: true }); } catch (_) {}
}
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
  '.task': 'application/octet-stream',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.gif': 'image/gif'
};

function json(res, code, obj) {
  if (res.headersSent || res.writableEnded) return;
  const body = JSON.stringify(obj);
  const h = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  try {
    res.writeHead(code, h);
    res.write(body);
    res.end();
  } catch (_) {}
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

// video dataURL from client -> video file (mp4 or webm)
function decodeVideo(dataURL) {
  if (!dataURL || typeof dataURL !== 'string') return null;
  let ext = 'mp4';
  let b64 = dataURL;
  const comma = dataURL.indexOf(',');
  if (comma !== -1) {
    const prefix = dataURL.slice(0, comma);
    b64 = dataURL.slice(comma + 1);
    if (/webm/i.test(prefix)) ext = 'webm';
    else if (/mp4/i.test(prefix)) ext = 'mp4';
    else if (/quicktime|mov/i.test(prefix)) ext = 'mov';
  }
  let buf;
  try { buf = Buffer.from(b64, 'base64'); } catch (e) { return null; }
  return { ext, buf };
}

// Convert any incoming video buffer (WebM, fMP4, etc.) to 100% standard progressive H.264 MP4 with faststart & AAC
// Maintains exact playback timing, full 5.0s duration, and constant framerate for universal mobile playback.
function convertVideoToStandardMp4(inputBuffer, inputExt, targetFpsOrCallback, maybeCallback) {
  let targetFps = 24;
  let callback;
  if (typeof targetFpsOrCallback === 'function') {
    callback = targetFpsOrCallback;
  } else {
    if (typeof targetFpsOrCallback === 'number' && !isNaN(targetFpsOrCallback)) {
      targetFps = Math.max(12, Math.min(30, Math.round(targetFpsOrCallback)));
    }
    callback = maybeCallback;
  }

  const tmpId = crypto.randomUUID();
  const inExt = inputExt || 'webm';
  const inPath = path.join(os.tmpdir(), `conv_${tmpId}.${inExt}`);
  const outPath = path.join(os.tmpdir(), `conv_${tmpId}_out.mp4`);

  try {
    fs.writeFileSync(inPath, inputBuffer);
  } catch (err) {
    return callback(err);
  }

  // Universal H.264 Baseline/High with Even Dimensions + AAC Audio + FastStart MOOV
  // Preserve full photostrip video frames without false duplicate drops, locking duration strictly to intended PTS
  const args = [
    '-y',
    '-i', inPath,
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-vf', `scale=trunc(iw/2)*2:trunc(ih/2)*2,setpts=PTS-STARTPTS`,
    '-r', String(targetFps),
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-shortest',
    '-movflags', '+faststart',
    outPath
  ];

  execFile('ffmpeg', args, { timeout: 30000 }, (err, stdout, stderr) => {
    try { if (fs.existsSync(inPath)) fs.unlinkSync(inPath); } catch (_) {}
    if (err) {
      console.error('ffmpeg conversion error:', err, stderr);
      try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) {}
      return callback(err);
    }
    try {
      const outBuf = fs.readFileSync(outPath);
      try { fs.unlinkSync(outPath); } catch (_) {}
      return callback(null, outBuf);
    } catch (readErr) {
      return callback(readErr);
    }
  });
}

function handleConvertVideo(req, res) {
  let raw = '';
  req.on('data', (c) => raw += c);
  req.on('end', () => {
    let body;
    try { body = JSON.parse(raw); } catch (e) { return json(res, 400, { error: 'bad json' }); }
    const v = decodeVideo(String(body.video || ''));
    if (!v || !v.buf || !v.buf.length) {
      return json(res, 400, { error: 'valid video required' });
    }
    let filename = String(body.filename || `ukmexpo-video-${Date.now()}.mp4`).replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!filename.endsWith('.mp4')) filename = filename.replace(/\.[^.]+$/, '') + '.mp4';
    let targetFps = 24;
    if (body.fps && !isNaN(Number(body.fps))) {
      targetFps = Math.max(12, Math.min(30, Math.round(Number(body.fps))));
    }

    convertVideoToStandardMp4(v.buf, v.ext, targetFps, (err, mp4Buf) => {
      if (err || !mp4Buf) {
        console.error('Failed to convert video for client download:', err);
        return json(res, 500, { error: 'conversion failed' });
      }
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': mp4Buf.byteLength,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      res.write(mp4Buf);
      res.end();
    });
  });
}

function saveSheetVideo(req, res) {
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
    const v = decodeVideo(String(body.video || ''));
    if (!v) return json(res, 400, { error: 'video required' });
    convertVideoToStandardMp4(v.buf, v.ext, (err, mp4Buf) => {
      if (!err && mp4Buf) {
        fs.writeFileSync(path.join(dir, 'sheet.mp4'), mp4Buf);
      } else {
        fs.writeFileSync(path.join(dir, 'sheet.' + v.ext), v.buf);
      }
      json(res, 200, { ok: true });
    });
  });
}

// public base: header X-Public-Url (Caddy per-vhost) > PUBLIC_URL env > request Host
function publicBase(req) {
  const h = req.headers['x-public-url'];
  if (h) return h.replace(/\/$/, '');
  return (PUBLIC || `http://${req.headers.host}`).replace(/\/$/, '');
}

// Load optional .env file
try {
  const envFile = path.join(ROOT, '.env');
  if (fs.existsSync(envFile)) {
    const raw = fs.readFileSync(envFile, 'utf8');
    raw.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eq = trimmed.indexOf('=');
        if (eq !== -1) {
          const k = trimmed.slice(0, eq).trim();
          const v = trimmed.slice(eq + 1).trim();
          if (!process.env[k]) process.env[k] = v;
        }
      }
    });
  }
} catch (_) {}

const GROQ_KEYS = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
let groqKeyIdx = 0;

const SYSTEM_PROMPT = `Kamu adalah sistem AI Computer Vision & Biometric Craniofacial Analyzer presisi tinggi.
Tugasmu: Analisis foto wajah secara SANGAT TELITI, OBJEKTIF, REALISTIS, dan AKURAT untuk mendeteksi GENDER (Laki-laki vs Perempuan), USIA BIOLOGIS NYATA (rentang 15 - 85+ tahun), BENTUK WAJAH, CIRI FISIK NYATA, KONDISI KULIT & KERUTAN, dan KEMBARAN TOKOH PALING MIRIP dari database 1.000 tokoh dunia.

DIAGNOSTIK INDIKATOR USIA BIOLOGIS DARI KERUTAN & STRUKTUR WAJAH (SANGAT KRUSIAL):
Lakukan inspeksi visual langkah-demi-langkah terhadap indikator penuaan & kematangan wajah berikut:
1. Dahi & Glabella (Kerutan Dahi & Frown Lines):
   - 15 - 22 thn: Mulus sempurna, tidak ada lipatan horizontal dahi atau garis vertikal glabella (antara alis) bahkan saat ekspresi biasa.
   - 23 - 32 thn: Dahi mulus saat rileks, garis ekspresi sangat halus dinamis hanya muncul saat menaikkan alis dan cepat hilang.
   - 33 - 45 thn: Garis dahi horizontal mulai menetap halus (garis statis), terlihat kerutan samar antara alis (garis 11).
   - 46 - 60 thn: Garis horizontal dahi dan vertikal glabella terukir jelas & permanen meski wajah rileks.
   - 60+ thn: Kerutan dahi mendalam, lipatan kulit dahi dan pelipis tebal & jelas.

2. Area Mata & Periorbital (Crow's Feet, Kantung Mata, Tear Troughs):
   - 15 - 22 thn: Kulit bawah mata sangat kencang & halus tanpa lingkar/kantung mata usia, sudut luar mata bebas kerutan.
   - 23 - 32 thn: Garis halus dinamis di sudut mata hanya saat tertawa/tersenyum lebar.
   - 33 - 45 thn: Kerutan sudut mata (crow's feet) mulai terlihat saat senyum biasa, tear trough/kantung mata mulai tampak.
   - 46 - 60 thn: Crow's feet jelas terlihat permanen, kelopak mata sedikit turun (hooded eyes), kantung mata jelas terdefinisi.
   - 60+ thn: Kerutan periorbital dalam meluas ke pelipis dan pipi atas, kulit periorbital menipis.

3. Area Pipi & Mulut (Lipatan Senyum Nasolabial & Garis Marionette):
   - 15 - 22 thn: Pipi penuh/plump kenyal (baby fat alami), lipatan samping hidung langsung hilang seketika saat wajah rileks.
   - 23 - 32 thn: Kontur pipi lebih terdefinisi dewasa, lipatan nasolabial samar saat rileks.
   - 33 - 45 thn: Lipatan nasolabial (smile lines) terukir permanen dari samping hidung ke sudut bibir.
   - 46 - 60 thn: Lipatan nasolabial dalam, garis marionette (sudut mulut ke rahang bawah) mulai tampak.
   - 60+ thn: Garis marionette dan nasolabial sangat dalam, sudut bibir melengkung ke bawah alami.

4. Tekstur Kulit, Elastisitas & Garis Rahang:
   - 15 - 22 thn: Sangat kencang, pori-pori halus, elastisitas maksimal, garis rahang bersih tanpa sagging.
   - 23 - 35 thn: Tekstur kulit segar & sehat, elastisitas prima, kontur wajah tegas.
   - 36 - 50 thn: Tekstur kulit matang, sedikit penurunan elastisitas di garis rahang bawah.
   - 51 - 65 thn: Tekstur kulit matang, sedikit kendur di rahang bawah/bawah dagu (jowls ringan), garis leher horizontal tampak.
   - 65+ thn: Kulit menipis, elastisitas berkurang, bintik usia/tekstur senior terdefinisi.

5. Rambut & Kematangan Wajah:
   - Rambut hitam/berwarna alami muda vs uban di pelipis/cambang (38-50) vs rambut beruban/putih dominan (50-70+).

PERINGATAN KERAS ANTI-BIAS UMUR:
DILARANG KERAS SELALU MENEBAK 19, 20, ATAU 21 TAHUN!
Tentukan umur biologis aktual secara objektif, jujur, dan spesifik (bisa 16, 18, 23, 27, 31, 36, 42, 48, 55, 63, 70+ tahun) berdasarkan bukti kerutan & tekstur wajah di atas.

PANDUAN KLASIFIKASI GENDER (SANGAT KRUSIAL - MUTLAK DILARANG SALAH TEBAK):
1. ATURAN KERUDUNG/HIJAB (MUTLAK 100% PEREMPUAN):
   - Jika pengguna mengenakan HIJAB, JILBAB, KERUDUNG, CIPUT, atau PASMINA, WAJIB MUTLAK 100% diklasifikasikan sebagai "Perempuan 👧". DILARANG KERAS menebak laki-laki jika terlihat memakai hijab/kerudung/jilbab!
2. ATURAN RAMBUT PANJANG & RIASAN (MUTLAK 100% PEREMPUAN):
   - RAMBUT PANJANG (terurai ke bahu/dada, kuncir kuda, kuncir dua, kepang, bando wanita, atau gaya rambut feminin): WAJIB MUTLAK diklasifikasikan sebagai "Perempuan 👧".
   - Riasan wajah (lipstik/lipgloss, perona pipi/blush, pensil alis, eyeliner, maskara), anting/giwang wanita, atau struktur wajah feminin: WAJIB diklasifikasikan sebagai "Perempuan 👧".
3. ATURAN PRIA (LAKI-LAKI 👦):
   - Hanya klasifikasikan sebagai "Laki-laki 👦" jika subjek memiliki potongan rambut pendek khas pria (undercut, fade, cepak, crop, pompadour pendek, belah samping pria), atau terlihat kumis, jenggot, jambang, atau jakun leher pria tanpa riasan feminin.
   - Pria muda berkulit bersih/tanpa jenggot dengan potongan rambut pendek pria tetap LAKI-LAKI 👦.
   - JIKA RAGU/AMBIGU: jika ada rambut panjang, hijab, atau sentuhan riasan wajah => WAJIB PILIH "Perempuan 👧".

PANDUAN GENERASI (SESUAIKAN PERSIS DENGAN UMUR):
- <= 19 Tahun: "Gen-Z Fresh 🎓"
- 20 - 27 Tahun: "Gen-Z Active 🌟"
- 28 - 39 Tahun: "Milenial Leader 💼"
- 40 - 54 Tahun: "Prime Leader 🏛️"
- 55 - 69 Tahun: "Senior Mentor 📚"
- 70+ Tahun: "Maestro Kehormatan 👑"

PENCOCOKKAN KEMBARAN TOKOH (LOOKALIKE) WAJIB SESUAI GENDER & USIA:
- Analisis struktur rahang, proporsi mata, senyuman, bentuk dahi, dan aura wajah foto untuk mencocokkan kembaran figur publik terkenal dunia atau Indonesia (artis sinema, musisi, atlet, kreator, idola pop/global, atau tokoh inspiratif).
- PRINSIP KEBERAGAMAN MAKSIMAL & ANTI-REPETISI (1.000 TOKOH DUNIA):
  * DILARANG KERAS terpaku pada 1-2 nama tokoh tertentu (seperti Jack Dorsey, Elon Musk, atau Shenina Cinnamon)!
  * Pilih kembaran figur publik secara dinamis dan bervariasi dari beragam kategori: aktor/aktris perfilman, musisi (pop/rock/indie/jazz), seniman, atlet olahraga, inovator, dan figur inspiratif Indonesia maupun dunia.
  * Jelajahi database 1.000 tokoh secara kaya dan merata murni berdasarkan observasi visual foto (bentuk wajah, sorot mata, senyuman, proporsi rahang) serta rekomendasi kandidat biometrik.
- SESUAIKAN DENGAN GENDER & RENTANG USIA SUBJEK:
  * Pengunjung Remaja / Gen-Z (15-27 thn): Pilih tokoh publik / artis / idola / atlet generasi muda.
  * Pengunjung Dewasa / Milenial (28-48 thn): Pilih artis / tokoh publik generasi matang.
  * Pengunjung Senior / Lansia (49-80+ thn): Pilih tokoh berwibawa, negarawan, ilmuwan, atau legenda seni peran senior.
  * JANGAN PERNAH memasangkan orang tua/lansia dengan artis remaja belia!
- Jika disediakan daftar [Kandidat Tokoh Rekomendasi Biometrik], gunakan sebagai rekomendasi presisi atau pilih figur publik terkenal lain yang lebih mirip secara visual.

ATURAN PANJANG TEKS (WAJIB SUPER RINGKAS & PUNCHY UNTUK KARTU PHOTOBOOTH):
1. wrinkleAnalysis: WAJIB SANGAT RINGKAS (Maksimal 3-4 kata + 1 emoji). Contoh: "Kulit Halus & Kencang ✨", "Tekstur Segar Alami 😊", "Garis Rahang Tegas 🌟", "Wajah Matang Berwibawa 🧐". DILARANG menuliskan paragraf atau kalimat panjang!
2. comment: WAJIB TEPAT 1 KALIMAT SINGKAT, PADAT, & PUNCHY (Maksimal 10-14 kata). Contoh: "Tatapan mata tajam dengan struktur wajah simetris penuh karisma!" DILARANG bertele-tele atau membuat narasi panjang!
3. lookalikeRole: MAKSIMAL 3-4 KATA (Contoh: "Aktris & Edukator Cerdas", "Aktor & Musisi Berbakat").

Kembalikan HANYA format JSON murni tanpa markdown:
{
  "gender": "<Laki-laki 👦 / Perempuan 👧>",
  "age": <integer umur realistis 15-85>,
  "generation": "<Gen-Z Fresh 🎓 / Gen-Z Active 🌟 / Milenial Leader 💼 / Prime Leader 🏛️ / Senior Mentor 📚 / Maestro Kehormatan 👑>",
  "faceShape": "<Oval / Square / Angular / Round / Soft / Heart / V-Shape / Diamond / Chiseled / Oblong / Regal>",
  "beautyScore": <skor pesona 88-99 integer>,
  "symmetryScore": <skor simetri 88-99 integer>,
  "wrinkleAnalysis": "<Frasa ringkas max 3-4 kata + 1 emoji>",
  "lookalike": "<Nama Tokoh yang paling mirip struktur wajahnya (bebas batas gender)>",
  "lookalikeRole": "<Profesi/julukan singkat max 3-4 kata>",
  "lookalikeMatch": <persen 88-98 integer>,
  "majorVibe": "<misal: Sains Data & AI / Inovasi & Teknologi / Seni Kreatif>",
  "comment": "<1 kalimat tajam & personal max 10-14 kata>",
  "facialTraits": "<3 ciri fisik terdeteksi, pisahkan koma>"
}`;

function getOmniRouteKey() {
  if (process.env.HERMES_CUSTOM_LOCALHOST_20128_API_KEY) return process.env.HERMES_CUSTOM_LOCALHOST_20128_API_KEY.trim();
  if (process.env.OMNIRUTE_API_KEY) return process.env.OMNIRUTE_API_KEY.trim();
  try {
    const keyFile = path.join(os.homedir(), 'keys_omniroute_20128.txt');
    if (fs.existsSync(keyFile)) {
      const line = fs.readFileSync(keyFile, 'utf8').split('\n')[0].trim();
      if (line) return line;
    }
  } catch (_) {}
  return '';
}

function getDiverseLookalikeCandidates(telemetry, gender, estAge, count = 8) {
  try {
    const res = findBestLookalike(telemetry || {}, { age: estAge, topK: 35, randomizeTop: true });
    const topMatches = (res && res.topMatches) || [];
    if (!topMatches.length) return [];

    const shuffled = [...topMatches].sort(() => Math.random() - 0.5);
    const selected = [];
    const usedCategories = new Set();

    for (const m of shuffled) {
      const cat = m.celeb.category || 'Umum';
      if (!usedCategories.has(cat)) {
        selected.push(m);
        usedCategories.add(cat);
        if (selected.length >= count) break;
      }
    }

    if (selected.length < count) {
      for (const m of shuffled) {
        if (!selected.some(s => s.celeb.id === m.celeb.id)) {
          selected.push(m);
          if (selected.length >= count) break;
        }
      }
    }
    return selected.slice(0, count);
  } catch (_) {
    return [];
  }
}

async function callOmniRouteVision(photo, telemetry) {
  const key = getOmniRouteKey();
  if (!key) return null;

  let telemetryText = 'Lakukan analisis biometrik wajah & estimasi umur biologis dari foto ini secara presisi dan objektif:';
  if (telemetry) {
    telemetryText = `Data Pengukuran Sensor Biometrik 3D:
- Bentuk Wajah Terukur: ${telemetry.faceShape || 'Oval'}
- Simetri Wajah Terukur: ${telemetry.symmetryPct || 95}%
- Intensitas Senyuman: ${telemetry.smilePct || 80}%

PENTING:
1. PENCOCOKAN BEBAS GENDER: JANGAN batasi kembaran tokoh berdasarkan gender subjek. Fokuskan pencocokan murni pada kemiripan struktur kontur wajah, bentuk mata, garis senyum, rahang, dan hidung. Pengunjung perempuan bisa mirip dengan tokoh pria, dan pengunjung pria bisa mirip dengan tokoh wanita jika proporsi wajahnya memang identik. Prioritaskan kemiripan visual yang nyata!
2. Tentukan USIA BIOLOGIS NYATA (15-85+ thn) dan KONDISI KULIT/KERUTAN murni dari observasi visual foto secara jujur (amati kerutan dahi, kantung mata, crow's feet, garis tawa/nasolabial, tekstur kulit, atau uban). JANGAN terjebak default usia 19-21 tahun!
3. Pilih KEMBARAN TOKOH / FIGUR PUBLIK yang BENAR-BENAR COCOK secara struktur kraniofasial dan kelompok usia pengunjung (aktor/aktris, musisi, atlet, atau tokoh inspiratif dunia maupun Indonesia). Tulis nama lengkap tokoh yang umum dikenal. JANGAN pasangkan orang tua dengan figur remaja belia.`;
  }

  const models = ['agy/gemini-3.5-flash-lite', 'antigravity/gemini-3.5-flash-lite', 'agy/gemini-3-flash'];

  for (const model of models) {
    const payload = JSON.stringify({
      model: model,
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
      max_tokens: 2000,
      temperature: 0.7
    });

    const res = await new Promise((resolve) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: 20128,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + key,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 8000
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
                  const data = JSON.parse(m[0]);
                  if (data && (data.gender || data.age)) {
                    return resolve(data);
                  }
                }
              }
            } catch (_) {}
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

async function callGroqVision(photo, telemetry) {
  let telemetryText = 'Lakukan analisis biometrik wajah & estimasi umur biologis dari foto ini secara presisi dan objektif:';
  if (telemetry) {
    telemetryText = `Data Pengukuran Sensor Biometrik 3D:
- Bentuk Wajah Terukur: ${telemetry.faceShape || 'Oval'}
- Simetri Wajah Terukur: ${telemetry.symmetryPct || 95}%
- Intensitas Senyuman: ${telemetry.smilePct || 80}%
- Rasio Rahang (Jaw Ratio): ${(telemetry.jawRatio || 0.55).toFixed ? (telemetry.jawRatio || 0.55).toFixed(3) : telemetry.jawRatio}
- Rasio Dagu (Chin Ratio): ${(telemetry.chinRatio || 0.62).toFixed ? (telemetry.chinRatio || 0.62).toFixed(3) : telemetry.chinRatio}
- Rasio Mata (Eye Ratio): ${(telemetry.eyeRatio || 0.38).toFixed ? (telemetry.eyeRatio || 0.38).toFixed(3) : telemetry.eyeRatio}
- Indeks Ketegangan Wajah: ${(telemetry.wrinkleTension || 0.20).toFixed ? (telemetry.wrinkleTension || 0.20).toFixed(3) : telemetry.wrinkleTension}

PENTING:
1. PENCOCOKAN BEBAS GENDER: JANGAN batasi kembaran tokoh berdasarkan gender subjek. Fokuskan pencocokan murni pada kemiripan struktur kontur wajah, bentuk mata, garis senyum, rahang, dan hidung. Perempuan bisa mirip dengan tokoh pria, dan pria bisa mirip dengan tokoh wanita jika proporsi wajahnya identik. Prioritaskan kemiripan visual yang nyata!
2. Tentukan USIA BIOLOGIS NYATA (15-85+ thn) dan KONDISI KULIT/KERUTAN murni dari observasi visual foto secara jujur (amati kerutan dahi, kantung mata, crow's feet, garis tawa/nasolabial, tekstur kulit, atau uban). JANGAN terjebak default usia 19-21 tahun!
3. Pilih KEMBARAN TOKOH / FIGUR PUBLIK yang BENAR-BENAR COCOK secara struktur kraniofasial dan kelompok usia pengunjung (aktor/aktris, musisi, atlet, atau tokoh inspiratif dunia maupun Indonesia). Tulis nama lengkap tokoh yang umum dikenal. JANGAN pasangkan orang tua dengan figur remaja belia.`;
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
    max_completion_tokens: 450,
    temperature: 0.7
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
        timeout: 8000
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

const FALLBACK_CELEBS = {
  maleYoung: [
    { name: 'Iqbaal Ramadhan 🎸', role: 'Aktor & Musisi Berbakat', faceShape: 'Oval', comment: 'Tatapan tajam dan proporsi wajah simetris penuh karisma!', traits: ['Simetris proporsional', 'Ekspresi cerah positif', 'Karisma tinggi'] },
    { name: 'Angga Yunanda 🌟', role: 'Aktor & Model Berbakat', faceShape: 'V-Shape', comment: 'Garis rahang tirus tegas dengan aura bintang muda memikat!', traits: ['Rahang tirus proporsional', 'Sorot mata hangat', 'Senyum karismatik'] },
    { name: 'Timothée Chalamet 🎬', role: 'Aktor Global Karismatik', faceShape: 'Diamond / Chiseled', comment: 'Struktur tulang pipi tegas dengan tatapan artistik mendalam!', traits: ['Tulang pipi tinggi', 'Garis rahang tajam', 'Ekspresi puitis'] },
    { name: 'Nadhif Basalamah 🎶', role: 'Penyanyi & Komponis Cerdas', faceShape: 'Oval', comment: 'Senyum hangat bersahabat dengan proporsi wajah simetris!', traits: ['Senyum ramah natural', 'Tatapan tenang', 'Struktur seimbang'] },
    { name: 'Tom Holland 🕷️', role: 'Aktor & Bintang Hollywood', faceShape: 'Square / Angular', comment: 'Bentuk wajah dinamis penuh energi positif dan keceriaan!', traits: ['Garis rahang bersih', 'Ekspresi ceria antusias', 'Mata ekspresif'] },
    { name: 'Jerome Polin 📐', role: 'Kreator & Edukator Cerdas', faceShape: 'Round / Soft', comment: 'Aura cerdas penuh antusiasme dengan senyum ramah terbuka!', traits: ['Senyum lebar positif', 'Tatapan cerdas', 'Wajah ramah'] },
    { name: 'Cha Eun-woo ✨', role: 'Aktor & Bintang Pop Asia', faceShape: 'Oval', comment: 'Proporsi rasio emas wajah dengan simetri nyaris sempurna!', traits: ['Rasio emas proporsional', 'Mata berbinar', 'Garis wajah rapi'] },
    { name: 'Windah Basudara 🎮', role: 'Kreator Konten & Penghibur', faceShape: 'Round / Soft', comment: 'Ekspresi penuh energi positif dan kehangatan tulus!', traits: ['Senyum ekspresif', 'Aura bersahabat', 'Wajah ramah'] }
  ],
  maleMature: [
    { name: 'Nicholas Saputra 🕶️', role: 'Aktor Ikonik Sinema Indonesia', faceShape: 'Oval', comment: 'Tatapan mata tajam misterius dengan garis rahang proporsional!', traits: ['Tatapan mata intens', 'Rahang proporsional', 'Aura karismatik tenang'] },
    { name: 'Reza Rahadian 🎭', role: 'Aktor Karakter & Maestro Peran', faceShape: 'Square / Angular', comment: 'Struktur wajah ekspresif penuh daya hidup dan intensitas!', traits: ['Garis ekspresi tegas', 'Sorot mata tajam', 'Proporsi matang berwibawa'] },
    { name: 'Refal Hady ☕', role: 'Aktor Karismatik & Berwibawa', faceShape: 'Square / Angular', comment: 'Garis rahang maskulin tegas dengan senyum teduh memikat!', traits: ['Rahang maskulin kokoh', 'Tatapan hangat', 'Aura teduh berwibawa'] },
    { name: 'David Brendi (GadgetIn) 📱', role: 'Kreator Teknologi Terpercaya', faceShape: 'Oval', comment: 'Proporsi wajah seimbang dengan ekspresi komunikatif terpercaya!', traits: ['Tatapan fokus cerdas', 'Senyum ramah', 'Wajah seimbang'] },
    { name: 'Ryan Gosling 🎹', role: 'Aktor Hollywood & Musisi', faceShape: 'Oblong / Regal', comment: 'Struktur wajah matang tenang dengan sorot mata puitis!', traits: ['Garis rahang memanjang', 'Sorot mata tenang', 'Senyum tipis berkarisma'] },
    { name: 'Keanu Reeves 🏍️', role: 'Aktor Legendaris Penuh Karisma', faceShape: 'Oval', comment: 'Aura rendah hati berpadu dengan ketegasan garis wajah ikonik!', traits: ['Garis wajah simetris', 'Tatapan bijaksana', 'Karisma abadi'] }
  ],
  maleSenior: [
    { name: 'Prof. B.J. Habibie 🚀', role: 'Teknokrat Visioner & Presiden ke-3 RI', faceShape: 'Oval', comment: 'Sorot mata jenius penuh imajinasi dengan senyum ramah kebapakan!', traits: ['Mata binar kecerdasan', 'Dahi intelektual luas', 'Senyum kebapakan'] },
    { name: 'Steve Jobs 💻', role: 'Inovator Visioner Apple', faceShape: 'Oval', comment: 'Tatapan mata intens penuh visi masa depan dan standar kesempurnaan!', traits: ['Sorot mata fokus visioner', 'Garis rahang tegas', 'Aura inovator'] },
    { name: 'Tony Leung Chiu-wai 🎬', role: 'Maestro Aktor Sinema Dunia', faceShape: 'Oval', comment: 'Kedalaman ekspresi mata yang mampu bercerita seribu makna!', traits: ['Tatapan mata puitis', 'Garis senyum bijak', 'Aura kharismatik tenang'] },
    { name: 'George Clooney ☕', role: 'Aktor & Produser Berwibawa', faceShape: 'Square / Angular', comment: 'Simbol ketampanan matang klasik dengan karisma tak lekang waktu!', traits: ['Rahang maskulin klasik', 'Senyum karismatik', 'Tatapan hangat percaya diri'] }
  ],
  femaleYoung: [
    { name: 'Maudy Ayunda 🎓', role: 'Aktris & Edukator Berprestasi', faceShape: 'Oval', comment: 'Bentuk wajah proporsional dengan aura cerdas memikat!', traits: ['Simetris proporsional', 'Senyum cerdas cerah', 'Tatapan mata fokus'] },
    { name: 'Bernadya 🌧️', role: 'Penyanyi & Penulis Lagu Berbakat', faceShape: 'Oval', comment: 'Garis wajah lembut artistik dengan tatapan melankolis yang hangat!', traits: ['Ekspresi lembut tenang', 'Garis senyum natural', 'Aura puitis mendalam'] },
    { name: 'Chelsea Islan 🌸', role: 'Aktris & Aktivis Kepemudaan', faceShape: 'Round / Soft', comment: 'Senyum ceria binar positif dengan proporsi wajah segar alami!', traits: ['Mata berbinar riang', 'Pipi penuh vitalitas', 'Senyum optimis'] },
    { name: 'Prilly Latuconsina 🎬', role: 'Aktris & Produser Muda', faceShape: 'Heart / V-Shape', comment: 'Bentuk dagu lancip manis dengan senyum ramah penuh vitalitas!', traits: ['Dagu tirus manis', 'Tatapan gesit cerdas', 'Senyum penuh energi'] },
    { name: 'Freya Jayawardana (Freya JKT48) 🍦', role: 'Idol & Aktris Penuh Pesona', faceShape: 'Heart / V-Shape', comment: 'Garis wajah manis proporsional dengan senyum imut berenergi!', traits: ['Senyum manis memikat', 'Mata bulat cerah', 'Garis rahang lembut'] },
    { name: 'Zee Asadel 🌟', role: 'Aktris & Bintang Pop Generasi Z', faceShape: 'Heart / V-Shape', comment: 'Struktur wajah tegas modern berpadu dengan pesona energik!', traits: ['Tatapan mata tegas', 'Garis rahang modern', 'Aura bintang muda'] },
    { name: 'Sydney Sweeney 🚗', role: 'Aktris Hollywood Populer', faceShape: 'Oval', comment: 'Sorot mata ekspresif dengan garis bibir feminin penuh pesona!', traits: ['Mata ekspresif lembut', 'Bibir proporsional feminin', 'Garis wajah seimbang'] }
  ],
  femaleMature: [
    { name: 'Dian Sastrowardoyo 📚', role: 'Aktris Legendaris & Tokoh Budaya', faceShape: 'Oval', comment: 'Kecantikan klasik Nusantara dengan garis wajah anggun terpelajar!', traits: ['Proporsi wajah klasik', 'Tatapan berwibawa cerdas', 'Senyum anggun berkelas'] },
    { name: 'Najwa Shihab ⚖️', role: 'Jurnalis Kritis & Tokoh Inspiratif', faceShape: 'Heart / V-Shape', comment: 'Tatapan mata tajam berintegritas tinggi dengan rahang tegas percaya diri!', traits: ['Mata tajam fokus', 'Rahang tegas percaya diri', 'Aura intelek berwibawa'] },
    { name: 'Laura Basuki 🏆', role: 'Aktris Karakter Peraih Penghargaan', faceShape: 'Heart / V-Shape', comment: 'Garis rahang tirus anggun dengan tatapan artistik menenangkan!', traits: ['Garis rahang elegan', 'Kulit segar kencang', 'Sorot mata puitis'] },
    { name: 'Tara Basro 🌺', role: 'Aktris Berdaya & Ikon Pesona Eksotis', faceShape: 'Oval', comment: 'Karakter wajah kuat penuh percaya diri dan pesona autentik alami!', traits: ['Struktur tulang tegas', 'Senyum percaya diri', 'Aura autentik menawan'] },
    { name: 'Song Hye-kyo 👑', role: 'Ratu Drama Korea & Bintang Asia', faceShape: 'Oval', comment: 'Simetri wajah sempurna dengan keanggunan tenang yang abadi!', traits: ['Simetri wajah tinggi', 'Kulit halus bercahaya', 'Garis wajah proporsional'] },
    { name: 'Raisa Andriana 🎤', role: 'Diva Musik Pop Indonesia', faceShape: 'Oval', comment: 'Garis wajah feminin lembut dengan senyum manis memesona!', traits: ['Senyum manis anggun', 'Mata teduh hangat', 'Proporsi wajah halus'] }
  ],
  femaleSenior: [
    { name: 'Sri Mulyani Indrawati 💼', role: 'Ekonom Kelas Dunia & Pemimpin Publik', faceShape: 'Oval', comment: 'Tatapan mata tajam analitis dengan aura kepemimpinan global berwibawa!', traits: ['Tatapan analitis tajam', 'Dahi intelektual berwibawa', 'Aura kepemimpinan teguh'] },
    { name: 'Christine Hakim 🎭', role: 'Legenda Seni Peran & Duta Budaya', faceShape: 'Oval', comment: 'Kewibawaan seni mendalam terpancar dari setiap garis ekspresi wajah!', traits: ['Garis ekspresi berwibawa', 'Tatapan penuh kearifan', 'Aura maestro budaya'] },
    { name: 'Michelle Obama 📖', role: 'Advokat, Penulis & Tokoh Dunia', faceShape: 'Oval', comment: 'Senyum hangat penuh empati dan struktur wajah tegap menginspirasi!', traits: ['Senyum empati hangat', 'Garis rahang kokoh', 'Tatapan inspiratif'] },
    { name: 'Meryl Streep 🏆', role: 'Legenda Akting Sinema Dunia', faceShape: 'Oval', comment: 'Proporsi wajah ekspresif penuh kecerdasan seni peran legendaris!', traits: ['Sorot mata sarat pengalaman', 'Senyum penuh kehangatan', 'Garis wajah autentik'] }
  ]
};

function getRandomFallbackCeleb(isMale, estAge) {
  let pool;
  if (isMale) {
    if (estAge <= 28) pool = FALLBACK_CELEBS.maleYoung;
    else if (estAge <= 48) pool = FALLBACK_CELEBS.maleMature;
    else pool = FALLBACK_CELEBS.maleSenior;
  } else {
    if (estAge <= 28) pool = FALLBACK_CELEBS.femaleYoung;
    else if (estAge <= 48) pool = FALLBACK_CELEBS.femaleMature;
    else pool = FALLBACK_CELEBS.femaleSenior;
  }
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx];
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

    // 1. Try OmniRoute Vision first (agy/gemini-3.5-flash-lite - verified ultra accurate)
    let aiData = await callOmniRouteVision(photo, telemetry);
    let provider = 'omniroute';

    // 2. Secondary fallback to Groq if OmniRoute is unavailable
    if (!aiData && GROQ_KEYS.length > 0) {
      aiData = await callGroqVision(photo, telemetry);
      provider = 'groq';
    }

    if (aiData) {
      return json(res, 200, { ok: true, provider, ai: aiData, data: aiData });
    }

    // High precision calibrated fallback using 1,000 personalities biometric database
    const isMale = telemetry ? (typeof telemetry.isLikelyMale === 'boolean' ? telemetry.isLikelyMale : String(telemetry.gender || '').startsWith('Laki')) : true;
    const estAge = (telemetry && telemetry.estAge) || 22;
    let match = null;
    try {
      match = findBestLookalike(telemetry || {}, { age: estAge, topK: 10, randomizeTop: true });
    } catch (_) {}

    const defaultGen = estAge <= 19 ? 'Gen-Z Fresh 🎓' :
                       estAge <= 27 ? 'Gen-Z Active 🌟' :
                       estAge <= 39 ? 'Milenial Leader 💼' :
                       estAge <= 54 ? 'Prime Leader 🏛️' :
                       estAge <= 69 ? 'Senior Mentor 📚' : 'Maestro Kehormatan 👑';

    const defaultWrinkle = estAge <= 22 ? 'Kulit Halus & Kencang ✨' :
                           estAge <= 35 ? 'Tekstur Segar Alami 😊' :
                           estAge <= 50 ? 'Garis Rahang Tegas 🧐' : 'Garis Wajah Berwibawa 📚';

    const bestCeleb = (match && match.bestMatch) || getRandomFallbackCeleb(isMale, estAge);

    const fallbackData = {
      gender: isMale ? 'Laki-laki 👦' : 'Perempuan 👧',
      age: estAge,
      generation: (telemetry && telemetry.gen) || defaultGen,
      faceShape: (telemetry && telemetry.faceShape) || bestCeleb.faceShape || 'Oval',
      beautyScore: (telemetry && telemetry.beautyScore) || 94,
      symmetryScore: (telemetry && telemetry.symmetryPct) || 95,
      wrinkleAnalysis: (telemetry && telemetry.wrinkleLabel) || defaultWrinkle,
      lookalike: bestCeleb.name,
      lookalikeRole: bestCeleb.role,
      lookalikeMatch: (match && match.matchPct) || 95,
      majorVibe: 'Sains Data & AI',
      comment: bestCeleb.comment || 'Struktur wajah simetris dengan ekspresi positif & berkarisma!',
      facialTraits: Array.isArray(bestCeleb.traits) ? bestCeleb.traits.join(', ') : 'Simetris proporsional, Ekspresi positif, Berkarisma'
    };
    return json(res, 200, { ok: true, fallback: true, ai: fallbackData, data: fallbackData });
  });
}

function handleMatchByKeywords(req, res) {
  let raw = '';
  req.on('data', (c) => raw += c);
  req.on('end', () => {
    let body;
    try { body = JSON.parse(raw); } catch (e) { return json(res, 400, { error: 'bad json' }); }
    try {
      const result = matchCelebByKeywords(body, {
        gender: body.gender,
        category: body.category,
        topK: body.topK || 5
      });
      return json(res, 200, { ok: true, ...result });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
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
    const finalizeSession = () => {
      fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({
        sessionId: id,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + TTL_HOURS * 3600e3).toISOString(),
        photos: valid.length,
        hasVideo: !!body.video
      }));

      const base = publicBase(req);
      json(res, 200, { ok: true, id, url: `${base}/gallery/${id}` });
    };

    if (body.video) {
      const v = decodeVideo(String(body.video));
      if (v) {
        convertVideoToStandardMp4(v.buf, v.ext, (err, mp4Buf) => {
          if (!err && mp4Buf) {
            fs.writeFileSync(path.join(dir, 'boomerang.mp4'), mp4Buf);
          } else {
            fs.writeFileSync(path.join(dir, 'boomerang.' + v.ext), v.buf);
          }
          finalizeSession();
        });
        return;
      }
    }
    finalizeSession();
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

// QR target: jika ada video (sheet/boomerang), langsung unduh video; jika tidak, unduh sheet.png; fallback galeri
function downloadSheet(req, res, id) {
  const dir = path.join(UPLOAD_DIR, id);
  if (fs.existsSync(dir)) {
    const allFiles = fs.readdirSync(dir);
    const vFiles = allFiles.filter(f => /^(sheet|boomerang)\.(mp4|webm)$/i.test(f));
    if (vFiles.length) {
      const vFile = vFiles.find(f => f.startsWith('sheet')) || vFiles[0];
      const data = fs.readFileSync(path.join(dir, vFile));
      const ext = path.extname(vFile).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'video/mp4',
        'Content-Length': data.byteLength,
        'Content-Disposition': `attachment; filename="ukmexpo-video-${id.slice(0, 8)}${ext}"`
      });
      res.write(data);
      res.end();
      return;
    }
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

  const allFiles = fs.readdirSync(dir);
  const hasSheet = allFiles.includes('sheet.png');
  const photoFiles = allFiles.filter(f => /^photo-\d+\.(jpe?g|png)$/i.test(f)).sort();
  const vFiles = allFiles.filter(f => /^(sheet|boomerang)\.(mp4|webm)$/i.test(f));
  const sheetVideo = vFiles.find(f => f.startsWith('sheet') && f.endsWith('.mp4')) || vFiles.find(f => f.startsWith('sheet'));
  const boomerangVideo = vFiles.find(f => f.startsWith('boomerang') && f.endsWith('.mp4')) || vFiles.find(f => f.startsWith('boomerang'));
  const vFile = sheetVideo || boomerangVideo || (vFiles.length ? vFiles[0] : null);
  const base = publicBase(req);

  const heroImageSrc = hasSheet
    ? `${base}/uploads/sessions/${id}/sheet.png`
    : (photoFiles.length ? `${base}/uploads/sessions/${id}/${photoFiles[0]}` : null);
  const dlSheetUrl = `${base}/download/${id}`;
  const shortId = id.slice(0, 8);
  const expiresDate = new Date(meta.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });

  const primaryDlUrl = vFile ? `${base}/uploads/sessions/${id}/${vFile}` : (hasSheet ? dlSheetUrl : heroImageSrc);
  const primaryDlName = vFile ? `ukmexpo-video-${shortId}.${vFile.split('.').pop()}` : `ukmexpo-photostrip-${shortId}.png`;
  const primaryDlText = vFile ? `🎬 Unduh Video Photostrip (MP4)` : `⬇️ Unduh Photostrip Lengkap (HD PNG)`;

  const vHtml = vFile ? `
  <div class="section-card" style="margin-top:20px;">
    <div class="section-title">🎬 Video Photostrip / Boomerang Kamu</div>
    <div class="video-wrap">
      <video src="${base}/uploads/sessions/${id}/${vFile}" controls autoplay loop muted playsinline webkit-playsinline preload="auto"></video>
    </div>
    <div style="margin-top:14px;">
      <a download href="${base}/uploads/sessions/${id}/${vFile}" class="btn btn-gold">
        ⬇️ Unduh Video (MP4)
      </a>
    </div>
  </div>` : '';

  const photosHtml = photoFiles.length ? `
  <div class="section-card" style="margin-top:22px;">
    <div class="section-title">📸 Foto Satuan (${photoFiles.length})</div>
    <div class="photo-grid">
      ${photoFiles.map((f, idx) => `
        <div class="photo-item">
          <div class="photo-thumb-wrap">
            <img src="${base}/uploads/sessions/${id}/${f}" alt="Foto ${idx + 1}" loading="lazy">
          </div>
          <div class="photo-item-bar">
            <span class="photo-item-name">Foto #${idx + 1}</span>
            <a download="ukmexpo-${shortId}-foto-${idx + 1}.${f.split('.').pop()}" href="${base}/uploads/sessions/${id}/${f}" class="btn-sm-dl">⬇️ Unduh</a>
          </div>
        </div>
      `).join('')}
    </div>
  </div>` : '';

  const html = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="icon" href="data:,">
<title>UKM EXPO UHN ✦ Foto & 3D Hologram</title>
<style>
:root {
  --bg: #0d0b12;
  --card-bg: #171424;
  --card-border: rgba(207, 161, 56, 0.38);
  --gold: #cfa138;
  --gold-glow: rgba(207, 161, 56, 0.35);
  --gold-light: #f5d680;
  --text-main: #fbf9f4;
  --text-muted: #a69bb7;
  --rx: 0deg;
  --ry: 0deg;
  --rx-raw: 0;
  --ry-raw: 0;
  --holo-angle: 135deg;
  --holo-opacity: 0.65;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 16px 14px 40px;
  background: var(--bg);
  background-image: 
    radial-gradient(circle at 50% 0%, rgba(207, 161, 56, 0.16) 0%, transparent 65%),
    radial-gradient(circle at 85% 30%, rgba(138, 43, 226, 0.14) 0%, transparent 50%),
    radial-gradient(circle at 15% 70%, rgba(20, 160, 120, 0.1) 0%, transparent 50%);
  color: var(--text-main);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
}

.container {
  width: 100%;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.header {
  text-align: center;
  margin-bottom: 14px;
}

.brand-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(207, 161, 56, 0.12);
  border: 1px solid rgba(207, 161, 56, 0.45);
  color: var(--gold-light);
  padding: 5px 12px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  margin-bottom: 8px;
}

h1 {
  margin: 0 0 6px;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: 0.5px;
  background: linear-gradient(135deg, #ffffff 40%, var(--gold-light) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.session-info {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 12px;
  color: var(--text-muted);
}

.session-pill {
  background: rgba(255,255,255,0.06);
  padding: 3px 8px;
  border-radius: 6px;
  font-family: monospace;
  color: #fff;
  border: 1px solid rgba(255,255,255,0.1);
}

/* 3D PARALLAX GYRO STAGE */
.stage-3d {
  perspective: 1200px;
  width: 100%;
  max-width: 380px;
  margin: 12px auto 14px;
  display: flex;
  justify-content: center;
  touch-action: pan-y;
}

.card-3d {
  position: relative;
  width: 100%;
  border-radius: 18px;
  background: #130f1c;
  border: 2px solid var(--card-border);
  box-shadow:
    calc(var(--ry-raw) * -1.3px) calc(var(--rx-raw) * 1.3px + 16px) 34px rgba(0,0,0,0.72),
    0 0 24px rgba(207, 161, 56, 0.2);
  transform-style: preserve-3d;
  will-change: transform, box-shadow;
  transform: rotateX(var(--rx)) rotateY(var(--ry));
  transition: transform 0.05s linear;
  overflow: hidden;
  user-select: none;
  cursor: grab;
}

.card-3d:active {
  cursor: grabbing;
}

.card-3d.flat-mode {
  transform: none !important;
  box-shadow: 0 10px 28px rgba(0,0,0,0.6) !important;
}

.card-image-wrap {
  width: 100%;
  display: block;
  position: relative;
  background: #111;
  border-radius: 16px;
  overflow: hidden;
}

.card-img {
  width: 100%;
  height: auto;
  display: block;
  pointer-events: none;
}

/* Holographic Dynamic Glare Sheen */
.card-holo {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    var(--holo-angle),
    transparent 15%,
    rgba(255, 255, 255, 0.42) 32%,
    rgba(255, 215, 0, 0.45) 48%,
    rgba(0, 245, 255, 0.45) 62%,
    rgba(255, 0, 150, 0.38) 76%,
    transparent 90%
  );
  mix-blend-mode: color-dodge;
  opacity: var(--holo-opacity);
  transition: opacity 0.3s ease;
  z-index: 2;
}

.card-badge-top {
  position: absolute;
  top: 12px;
  left: 12px;
  background: rgba(19, 14, 27, 0.88);
  backdrop-filter: blur(8px);
  border: 1px solid var(--gold);
  color: var(--gold-light);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 1px;
  padding: 4px 10px;
  border-radius: 20px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.5);
  transform: translateZ(28px);
  z-index: 3;
}

.card-badge-bot {
  position: absolute;
  bottom: 12px;
  right: 12px;
  background: rgba(19, 14, 27, 0.88);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255,255,255,0.25);
  color: #fff;
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.5px;
  padding: 4px 9px;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.5);
  transform: translateZ(24px);
  z-index: 3;
}

/* 3D CONTROLS BAR */
.controls-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  max-width: 380px;
  margin-bottom: 16px;
  gap: 8px;
}

.ctrl-btn {
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.15);
  color: var(--text-main);
  padding: 8px 12px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s;
  text-decoration: none;
}

.ctrl-btn:active {
  transform: scale(0.96);
}

.ctrl-btn.active {
  background: rgba(207, 161, 56, 0.18);
  border-color: var(--gold);
  color: var(--gold-light);
}

.hint-pill {
  font-size: 11px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 4px;
}

/* ACTION BUTTONS */
.actions {
  width: 100%;
  max-width: 380px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px 20px;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
  border: none;
  transition: all 0.15s ease;
  width: 100%;
}

.btn:active {
  transform: scale(0.98);
}

.btn-gold {
  background: var(--gold);
  color: #1a0f02;
  box-shadow: 0 4px 16px var(--gold-glow);
}

.btn-gold:hover {
  background: var(--gold-light);
}

.btn-secondary {
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.16);
  color: #fff;
}

/* SECTION CARDS */
.section-card {
  width: 100%;
  max-width: 380px;
  background: var(--card-bg);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 16px;
  padding: 16px;
  margin-bottom: 14px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.3);
}

.section-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--gold-light);
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.video-wrap {
  width: 100%;
  border-radius: 12px;
  overflow: hidden;
  border: 2px solid rgba(207, 161, 56, 0.4);
  background: #000;
}

.video-wrap video {
  width: 100%;
  display: block;
}

.photo-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.photo-item {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.photo-thumb-wrap {
  width: 100%;
  aspect-ratio: 1;
  background: #000;
  position: relative;
  overflow: hidden;
}

.photo-thumb-wrap img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.photo-item-bar {
  padding: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.photo-item-name {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 600;
}

.btn-sm-dl {
  background: var(--gold);
  color: #1a0f02;
  text-decoration: none;
  font-size: 11px;
  font-weight: 700;
  padding: 4px 8px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
}

.footer {
  margin-top: 24px;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
}

.footer a {
  color: var(--gold-light);
  text-decoration: none;
  font-weight: 600;
}

/* TOAST */
#toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(23, 20, 36, 0.95);
  border: 1px solid var(--gold);
  color: #fff;
  padding: 10px 18px;
  border-radius: 30px;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 6px 20px rgba(0,0,0,0.6);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.25s ease;
  z-index: 1000;
}
</style>
</head>
<body>

<div class="container">
  <div class="header">
    <div class="brand-badge">✦ UKM EXPO UHN ✦ EXCLUSIVE PHOTO</div>
    <h1>Galeri Digital Kamu</h1>
    <div class="session-info">
      <span>Sesi <b class="session-pill">#${shortId}</b></span>
      <span>•</span>
      <span>Tersimpan s/d ${expiresDate}</span>
    </div>
  </div>

  ${heroImageSrc ? `
  <div class="stage-3d" id="stage3D">
    <div class="card-3d" id="card3D">
      <div class="card-image-wrap">
        <img src="${heroImageSrc}" alt="Photostrip UKM EXPO" class="card-img" id="cardImg">
      </div>
      <div class="card-holo" id="cardHolo"></div>
      <div class="card-badge-top">✦ UHN EXPO 2026 ✦</div>
      <div class="card-badge-bot">✨ 3D HOLOGRAM</div>
    </div>
  </div>

  <div class="controls-bar">
    <button type="button" class="ctrl-btn active" id="btnToggleTilt">
      <span id="tiltIcon">✨</span> <span id="tiltLabel">3D Parallax Tilt</span>
    </button>
    <div class="hint-pill" id="tiltHint">
      📱 Goyang HP / Tarik Kartu
    </div>
    <button type="button" class="ctrl-btn" id="btnReqGyro" style="display:none;">
      🧭 Izin Sensor
    </button>
  </div>
  ` : ''}

  <div class="actions">
    <a href="${primaryDlUrl}" download="${primaryDlName}" class="btn btn-gold">
      ${primaryDlText}
    </a>
    <button type="button" class="btn btn-secondary" id="btnShareLink">
      🔗 Salin Link Galeri Ini
    </button>
  </div>

  ${vHtml}

  ${photosHtml}

  <div class="footer">
    <p>Harkat Photobooth • Himpunan Mahasiswa Sains Data UHN</p>
    <p><a href="${base}/">← Ambil Foto Baru di Photobooth</a></p>
  </div>
</div>

<div id="toast">Link tersalin ke clipboard!</div>

<script>
(() => {
  const card = document.getElementById('card3D');
  const stage = document.getElementById('stage3D');
  const btnToggle = document.getElementById('btnToggleTilt');
  const btnReqGyro = document.getElementById('btnReqGyro');
  const tiltHint = document.getElementById('tiltHint');
  const toast = document.getElementById('toast');
  const btnShare = document.getElementById('btnShareLink');

  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.style.opacity = '1';
    setTimeout(() => { toast.style.opacity = '0'; }, 2200);
  }

  if (btnShare) {
    btnShare.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        showToast('✓ Link galeri berhasil disalin!');
      } catch (err) {
        showToast('Link: ' + location.href);
      }
    });
  }

  if (!card || !stage) return;

  let is3DEnabled = true;
  let targetRx = 0, targetRy = 0;
  let currentRx = 0, currentRy = 0;
  let isDragging = false;
  let dragStartX = 0, dragStartY = 0;
  let baseRx = 0, baseRy = 0;
  let hasGyro = false;

  // LERP render loop at 60fps
  function renderLoop() {
    if (is3DEnabled) {
      currentRx += (targetRx - currentRx) * 0.12;
      currentRy += (targetRy - currentRy) * 0.12;

      card.style.setProperty('--rx', currentRx.toFixed(2) + 'deg');
      card.style.setProperty('--ry', currentRy.toFixed(2) + 'deg');
      card.style.setProperty('--rx-raw', currentRx.toFixed(2));
      card.style.setProperty('--ry-raw', currentRy.toFixed(2));

      // Holographic glare calculations
      const angle = (Math.atan2(currentRx, currentRy) * (180 / Math.PI) + 135);
      card.style.setProperty('--holo-angle', angle.toFixed(1) + 'deg');
      const intensity = Math.min(0.85, 0.35 + (Math.abs(currentRx) + Math.abs(currentRy)) * 0.02);
      card.style.setProperty('--holo-opacity', intensity.toFixed(2));
    }
    requestAnimationFrame(renderLoop);
  }
  requestAnimationFrame(renderLoop);

  // DeviceOrientation handler for Mobile Gyroscope
  function handleOrientation(e) {
    if (!is3DEnabled) return;
    if (typeof e.gamma !== 'number' || typeof e.beta !== 'number' || isNaN(e.gamma) || isNaN(e.beta)) return;
    hasGyro = true;
    if (tiltHint) tiltHint.innerHTML = '📱 Miringkan HP Kamu';

    // Gamma: left-to-right (-90 to 90) -> mapped to rotateY
    let gamma = e.gamma;
    gamma = Math.max(-35, Math.min(35, gamma));
    targetRy = (gamma / 35) * 22; // max +-22 deg

    // Beta: front-to-back tilt (-180 to 180). Natural phone holding pitch is ~45-55 deg
    let beta = e.beta;
    let deltaBeta = beta - 48; // neutral at 48 deg viewing
    deltaBeta = Math.max(-35, Math.min(35, deltaBeta));
    targetRx = -(deltaBeta / 35) * 22; // max +-22 deg
  }

  // Attach deviceorientation listener immediately
  window.addEventListener('deviceorientation', handleOrientation, true);

  // Check iOS permission requirement if needed
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    if (btnReqGyro) {
      btnReqGyro.style.display = 'inline-flex';
      btnReqGyro.addEventListener('click', async () => {
        try {
          const resp = await DeviceOrientationEvent.requestPermission();
          if (resp === 'granted') {
            btnReqGyro.style.display = 'none';
            showToast('✓ Sensor Gyroscope Aktif!');
          } else {
            showToast('Izin sensor tidak diberikan');
          }
        } catch (err) {
          console.warn(err);
        }
      });
    }
  }

  // Touch drag fallback / enhancement
  stage.addEventListener('touchstart', (e) => {
    if (!is3DEnabled || e.touches.length > 1) return;
    isDragging = true;
    dragStartX = e.touches[0].clientX;
    dragStartY = e.touches[0].clientY;
    baseRx = targetRx;
    baseRy = targetRy;
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (!isDragging || !is3DEnabled) return;
    const dx = e.touches[0].clientX - dragStartX;
    const dy = e.touches[0].clientY - dragStartY;
    targetRy = Math.max(-25, Math.min(25, baseRy + (dx / 8)));
    targetRx = Math.max(-25, Math.min(25, baseRx - (dy / 8)));
  }, { passive: true });

  window.addEventListener('touchend', () => {
    if (isDragging) {
      isDragging = false;
      if (!hasGyro) {
        targetRx = 0;
        targetRy = 0;
      }
    }
  });

  // Desktop Mouse Movement
  stage.addEventListener('mousemove', (e) => {
    if (!is3DEnabled || hasGyro) return;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    targetRy = (x / (rect.width / 2)) * 20;
    targetRx = -(y / (rect.height / 2)) * 20;
  });

  stage.addEventListener('mouseleave', () => {
    if (!hasGyro && !isDragging) {
      targetRx = 0;
      targetRy = 0;
    }
  });

  // Toggle 3D Mode vs Flat Mode
  if (btnToggle) {
    btnToggle.addEventListener('click', () => {
      is3DEnabled = !is3DEnabled;
      if (is3DEnabled) {
        card.classList.remove('flat-mode');
        btnToggle.classList.add('active');
        document.getElementById('tiltIcon').textContent = '✨';
        document.getElementById('tiltLabel').textContent = '3D Parallax Tilt';
        if (tiltHint) tiltHint.style.opacity = '1';
        showToast('Mode 3D Aktif');
      } else {
        card.classList.add('flat-mode');
        btnToggle.classList.remove('active');
        document.getElementById('tiltIcon').textContent = '📄';
        document.getElementById('tiltLabel').textContent = 'Tampilan Datar';
        if (tiltHint) tiltHint.style.opacity = '0.4';
        showToast('Mode Datar Aktif');
      }
    });
  }
})();
</script>
</body>
</html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html) });
  res.write(html);
  res.end();
}


function getImageMime(buf) {
  if (buf && buf.length >= 4) {
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return 'image/webp';
  }
  return 'image/jpeg';
}

function isTitleRelevant(query, title) {
  if (!query || !title) return false;
  const qWords = query.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length >= 3);
  const tNorm = ' ' + title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ') + ' ';
  if (qWords.length === 0) return true;
  const lastWord = qWords[qWords.length - 1];
  if (new RegExp('\\b' + lastWord + '\\b').test(tNorm)) return true;
  const matchCount = qWords.filter(w => new RegExp('\\b' + w + '\\b').test(tNorm)).length;
  return (matchCount / qWords.length) >= 0.5;
}

function fetchWikiImage(query) {
  return new Promise((resolve) => {
    const clean = String(query).replace(/[\u{1F300}-\u{1FAFF}]/gu, '').replace(/[^\p{L}\p{N}\s.,-]/gu, '').trim();
    if (!clean) return resolve(null);

    const tryLang = (lang) => {
      return new Promise((resLang) => {
        const url = `https://${lang}.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(clean)}&limit=1&namespace=0&format=json`;
        https.get(url, { headers: { 'User-Agent': 'HarkatPhotobooth/2.0 (contact@harkat.id; https://harkat.id)' }, timeout: 4000 }, (res) => {
          if (res.statusCode !== 200) return resLang(null);
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              const title = parsed[1] && parsed[1][0];
              if (!title || !isTitleRelevant(clean, title)) return resLang(null);
              const sumUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
              https.get(sumUrl, { headers: { 'User-Agent': 'HarkatPhotobooth/2.0 (contact@harkat.id; https://harkat.id)' }, timeout: 4000 }, (res2) => {
                if (res2.statusCode !== 200) return resLang(null);
                let sData = '';
                res2.on('data', c => sData += c);
                res2.on('end', () => {
                  try {
                    const sum = JSON.parse(sData);
                    const img = sum.thumbnail?.source || sum.originalimage?.source || null;
                    resLang({ title, img });
                  } catch (_) { resLang(null); }
                });
              }).on('error', () => resLang(null));
            } catch (_) { resLang(null); }
          });
        }).on('error', () => resLang(null));
      });
    };

    tryLang('id').then(res => {
      if (res && res.img) return resolve(res);
      tryLang('en').then(resEn => {
        resolve(resEn || null);
      });
    });
  });
}

function fetchBuffer(url) {
  return new Promise((resolve) => {
    if (!url || typeof url !== 'string') return resolve(null);
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'HarkatPhotobooth/2.0 (contact@harkat.id; https://harkat.id) Mozilla/5.0' }, timeout: 7000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchBuffer(res.headers.location));
      }
      if (res.statusCode !== 200) return resolve(null);
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', () => resolve(null));
  });
}

function fetchBingImageUrl(query) {
  return new Promise((resolve) => {
    const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query + ' portrait photo')}`;
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      timeout: 5000
    }, (res) => {
      let html = '';
      res.on('data', c => html += c);
      res.on('end', () => {
        const matches = [...html.matchAll(/murl&quot;:&quot;(http[^&]+)&quot;/g)].map(m => m[1]);
        resolve(matches[0] || null);
      });
    }).on('error', () => resolve(null));
  });
}

async function getCelebImage(req, res, u) {
  const rawName = u.searchParams.get('name') || '';
  let cleanName = rawName.replace(/[\u{1F300}-\u{1FAFF}]/gu, '').replace(/[^\p{L}\p{N}\s.,-]/gu, '').trim();
  if (!cleanName) return json(res, 400, { error: 'name parameter required' });

  // Normalize diacritics / accents (e.g. René -> Rene, Rosé -> Rose, Mbappé -> Mbappe)
  const normalizedAscii = cleanName.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const slug = normalizedAscii.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const cachedFile = path.join(CELEB_CACHE_DIR, `${slug}.jpg`);

  if (fs.existsSync(cachedFile)) {
    const buf = fs.readFileSync(cachedFile);
    if (buf && buf.length > 10000) {
      res.writeHead(200, {
        'Content-Type': getImageMime(buf),
        'Content-Length': buf.length,
        'Cache-Control': 'public, max-age=604800',
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(buf);
    }
  }

  // 1. Check fuzzy match among existing cached files
  try {
    const allCached = fs.readdirSync(CELEB_CACHE_DIR);
    const slugParts = slug.split('_').filter(p => p.length > 2);
    const matched = allCached.find(f => {
      if (!f.endsWith('.jpg') && !f.endsWith('.png') && !f.endsWith('.webp')) return false;
      const base = f.replace(/\.[^.]+$/, '');
      return base === slug || base.includes(slug) || slug.includes(base) || (slugParts.length >= 2 && slugParts.every(p => base.includes(p)));
    });
    if (matched) {
      const buf = fs.readFileSync(path.join(CELEB_CACHE_DIR, matched));
      try { fs.copyFileSync(path.join(CELEB_CACHE_DIR, matched), cachedFile); } catch (_) {}
      res.writeHead(200, {
        'Content-Type': getImageMime(buf),
        'Content-Length': buf.length,
        'Cache-Control': 'public, max-age=604800',
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(buf);
    }
  } catch (_) {}

  // 2. Primary: Fast Wikipedia OpenSearch + Summary Fetcher (id -> en)
  try {
    const wikiInfo = await fetchWikiImage(cleanName);
    if (wikiInfo && wikiInfo.img) {
      const imgBuf = await fetchBuffer(wikiInfo.img);
      if (imgBuf && imgBuf.length > 500) {
        try { fs.writeFileSync(cachedFile, imgBuf); } catch (_) {}
        res.writeHead(200, {
          'Content-Type': getImageMime(imgBuf),
          'Content-Length': imgBuf.length,
          'Cache-Control': 'public, max-age=604800',
          'Access-Control-Allow-Origin': '*'
        });
        return res.end(imgBuf);
      }
    }
  } catch (_) {}

  // 3. Secondary: Bing Image Search fallback
  try {
    const bingUrl = await fetchBingImageUrl(cleanName);
    if (bingUrl) {
      const imgBuf = await fetchBuffer(bingUrl);
      if (imgBuf && imgBuf.length > 2000) {
        try { fs.writeFileSync(cachedFile, imgBuf); } catch (_) {}
        res.writeHead(200, {
          'Content-Type': getImageMime(imgBuf),
          'Content-Length': imgBuf.length,
          'Cache-Control': 'public, max-age=604800',
          'Access-Control-Allow-Origin': '*'
        });
        return res.end(imgBuf);
      }
    }
  } catch (_) {}

  // 4. Tertiary: Fallback to default portrait if still not found
  try {
    const fallbackDefault = path.join(CELEB_CACHE_DIR, 'angga_yunanda.jpg');
    if (fs.existsSync(fallbackDefault)) {
      const buf = fs.readFileSync(fallbackDefault);
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': buf.length,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(buf);
    }
  } catch (_) {}

  return json(res, 404, { error: 'celeb image not found', slug, name: cleanName });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if ((req.method === 'GET' || req.method === 'HEAD') && p === '/api/celeb-image') return getCelebImage(req, res, u);
  if (req.method === 'POST' && p === '/api/session') return createSession(req, res);
  if (req.method === 'POST' && p === '/api/sheet') return saveSheet(req, res);
  if (req.method === 'POST' && p === '/api/sheet-video') return saveSheetVideo(req, res);
  if (req.method === 'POST' && p === '/api/convert-video') return handleConvertVideo(req, res);
  if (req.method === 'POST' && (p === '/api/dev-ai-analyze' || (p === '/api/ai-analyze' && u.searchParams.get('env') === 'dev'))) {
    return analyzeFaceWithAiDev(req, res, json);
  }
  if (req.method === 'POST' && p === '/api/ai-analyze') return analyzeFaceWithAi(req, res);
  if (req.method === 'POST' && p === '/api/match-by-keywords') return handleMatchByKeywords(req, res);
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