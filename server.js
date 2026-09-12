// HARKAT Photobooth — server minimal: static serve + gallery session (QR download)
// No framework, no deps beyond stdlib. Sessions expire 24h and auto-cleanup hourly.
'use strict';
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { findBestLookalike, CELEBS_DATABASE_1000 } = require('./assets/data/celebs_database.js');

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
  '.task': 'application/octet-stream'
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

PANDUAN KLASIFIKASI GENDER:
- Ciri Laki-laki: Struktur alis alami/tebal tanpa pensil alis, tidak menggunakan riasan wajah/lipstik/eyeliner/mascara, proporsi garis rahang/dagu pria, garis leher/jakun/bahu pria, postur pria. Pria muda berkulit bersih/tanpa jenggot tetap LAKI-LAKI.
- Ciri Perempuan: Riasan wajah (eyeshadow, pensil alis, lipstick/gloss), bentuk bibir feminin dengan riasan, perhiasan wanita, gaya pakaian/rambut wanita.

PANDUAN GENERASI (SESUAIKAN PERSIS DENGAN UMUR):
- <= 19 Tahun: "Gen-Z Fresh 🎓"
- 20 - 27 Tahun: "Gen-Z Active 🌟"
- 28 - 39 Tahun: "Milenial Leader 💼"
- 40 - 54 Tahun: "Prime Leader 🏛️"
- 55 - 69 Tahun: "Senior Mentor 📚"
- 70+ Tahun: "Maestro Kehormatan 👑"

PENCOCOKKAN KEMBARAN TOKOH (LOOKALIKE) WAJIB SESUAI GENDER & USIA:
- Pilih figur dari database 1.000 tokoh dunia yang BENAR-BENAR COCOK dengan GENDER, KELOMPOK USIA, dan CIRI VISUALNYA:
  * Pria Muda (15-27 thn): Iqbaal Ramadhan, Jefri Nichol, Angga Yunanda, Timothée Chalamet, Jerome Polin, Windah Basudara, Tom Holland, dll.
  * Pria Dewasa/Matang (28-48 thn): Nicholas Saputra, Reza Rahadian, Refal Hady, GadgetIn David, Pedro Pascal, Keanu Reeves, Henry Cavill, Cillian Murphy, Ryan Gosling, dll.
  * Pria Senior/Orang Tua/Lansia (49-80+ thn): Prof. B.J. Habibie, Albert Einstein, Morgan Freeman, Steve Jobs, Bill Gates, George Clooney, Robert De Niro, Al Pacino, Harrison Ford, Tom Hanks, Joko Widodo, Anthony Hopkins, Nelson Mandela, Warren Buffett, dll.
  * Wanita Muda (15-27 thn): Maudy Ayunda, Chelsea Islan, Prilly Latuconsina, Zee JKT48, Freya JKT48, Jennie Blackpink, Karina aespa, Zendaya, Billie Eilish, dll.
  * Wanita Dewasa/Matang (28-48 thn): Dian Sastrowardoyo, Najwa Shihab, Laura Basuki, Song Hye-kyo, Anne Hathaway, Scarlett Johansson, Emma Stone, Gal Gadot, dll.
  * Wanita Senior/Orang Tua/Lansia (49-80+ thn): Sri Mulyani Indrawati, Christine Hakim, Meryl Streep, Megawati Soekarnoputri, Michelle Obama, Judi Dench, Helen Mirren, Queen Elizabeth II, dll.
- JANGAN PERNAH mencocokkan orang tua/lansia dengan artis remaja belia!

Kembalikan HANYA format JSON murni tanpa markdown:
{
  "gender": "<Laki-laki 👦 / Perempuan 👧>",
  "age": <integer umur realistis 15-85>,
  "generation": "<Gen-Z Fresh 🎓 / Gen-Z Active 🌟 / Milenial Leader 💼 / Prime Leader 🏛️ / Senior Mentor 📚 / Maestro Kehormatan 👑>",
  "faceShape": "<Oval / Square / Angular / Round / Soft / Heart / V-Shape / Diamond / Chiseled / Oblong / Regal>",
  "beautyScore": <skor pesona 88-99 integer>,
  "symmetryScore": <skor simetri 88-99 integer>,
  "wrinkleAnalysis": "<Deskripsi detail analisis tekstur kulit, garis senyum, dan kerutan wajah>",
  "lookalike": "<Nama Tokoh sesuai gender & rentang usia>",
  "lookalikeRole": "<Profesi/julukan tokoh>",
  "lookalikeMatch": <persen 88-98 integer>,
  "majorVibe": "<misal: Sains Data & AI / Kepemimpinan Strategis / Inovasi & Teknologi / Seni Kreatif>",
  "comment": "<1-2 kalimat analisis tajam & personal menyebutkan kesamaan ciri fisik foto dengan tokoh>",
  "facialTraits": "<3 ciri fisik terdeteksi, pisahkan koma>"
}`;

async function callGroqVision(photo, telemetry) {
  let telemetryText = 'Lakukan analisis biometrik wajah & estimasi umur biologis dari foto ini secara presisi dan objektif:';
  if (telemetry) {
    let candMale = '';
    let candFemale = '';
    try {
      const topM = findBestLookalike(telemetry, { gender: 'Laki-laki', topK: 5 }).topMatches;
      const topF = findBestLookalike(telemetry, { gender: 'Perempuan', topK: 5 }).topMatches;
      candMale = topM.map(m => `• ${m.celeb.name} [${m.celeb.faceShape}] - ${m.celeb.role} (Ciri: ${Array.isArray(m.celeb.traits) ? m.celeb.traits.join(', ') : m.celeb.traits})`).join('\n');
      candFemale = topF.map(m => `• ${m.celeb.name} [${m.celeb.faceShape}] - ${m.celeb.role} (Ciri: ${Array.isArray(m.celeb.traits) ? m.celeb.traits.join(', ') : m.celeb.traits})`).join('\n');
    } catch (_) {}

    telemetryText = `Data Pengukuran Sensor Biometrik 3D:
- Bentuk Wajah Terukur: ${telemetry.faceShape || 'Oval'}
- Simetri Wajah Terukur: ${telemetry.symmetryPct || 95}%
- Intensitas Senyuman: ${telemetry.smilePct || 80}%
- Rasio Rahang (Jaw Ratio): ${(telemetry.jawRatio || 0.55).toFixed ? (telemetry.jawRatio || 0.55).toFixed(3) : telemetry.jawRatio}
- Rasio Dagu (Chin Ratio): ${(telemetry.chinRatio || 0.62).toFixed ? (telemetry.chinRatio || 0.62).toFixed(3) : telemetry.chinRatio}
- Rasio Mata (Eye Ratio): ${(telemetry.eyeRatio || 0.38).toFixed ? (telemetry.eyeRatio || 0.38).toFixed(3) : telemetry.eyeRatio}
- Indeks Ketegangan Wajah: ${(telemetry.wrinkleTension || 0.20).toFixed ? (telemetry.wrinkleTension || 0.20).toFixed(3) : telemetry.wrinkleTension}

Kandidat Tokoh Rekomendasi Biometrik (Database 1.000 Tokoh Dunia):
[Kandidat Pria]:
${candMale}

[Kandidat Wanita]:
${candFemale}

PENTING:
1. Tentukan GENDER, USIA BIOLOGIS NYATA (15-85+ thn), dan KONDISI KULIT/KERUTAN murni dari observasi visual foto secara jujur (amati kerutan dahi, kantung mata, crow's feet, garis tawa/nasolabial, tekstur kulit, atau uban). JANGAN terjebak default usia 19-21 tahun!
2. Pilih KEMBARAN TOKOH yang BENAR-BENAR COCOK dengan GENDER dan KELOMPOK USIA pengunjung dari kandidat di atas atau tokoh 1.000 figur dunia. JANGAN pasangkan orang tua dengan figur remaja belia.`;
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
    temperature: 0.25
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

    // High precision fallback using 1,000 personalities biometric database
    const isMale = telemetry ? (typeof telemetry.isLikelyMale === 'boolean' ? telemetry.isLikelyMale : String(telemetry.gender || '').startsWith('Laki')) : true;
    let match = null;
    try {
      match = findBestLookalike(telemetry || {}, { gender: isMale ? 'Laki-laki' : 'Perempuan', topK: 3 });
    } catch (_) {}

    const estAge = (telemetry && telemetry.estAge) || 20;
    const defaultGen = estAge <= 19 ? 'Gen-Z Fresh 🎓' :
                       estAge <= 27 ? 'Gen-Z Active 🌟' :
                       estAge <= 39 ? 'Milenial Leader 💼' :
                       estAge <= 54 ? 'Prime Leader 🏛️' :
                       estAge <= 69 ? 'Senior Mentor 📚' : 'Maestro Kehormatan 👑';

    const defaultWrinkle = estAge <= 22 ? 'Kulit Halus & Kencang ✨' :
                           estAge <= 35 ? 'Tekstur Segar & Garis Senyum Alami 😊' :
                           estAge <= 50 ? 'Garis Wajah Tegas & Karisma Matang 🧐' : 'Garis Waktu Berwibawa & Penuh Pengalaman 📚';

    const bestCeleb = (match && match.bestMatch) || {
      name: isMale ? (estAge > 45 ? 'Prof. B.J. Habibie 🚀' : 'Iqbaal Ramadhan 🎸') : (estAge > 45 ? 'Sri Mulyani Indrawati 💼' : 'Maudy Ayunda 🎓'),
      role: isMale ? (estAge > 45 ? 'Teknokrat Visioner & Bapak Dirgantara' : 'Aktor & Musisi Muda Cerdas') : (estAge > 45 ? 'Ekonom Dunia & Pemimpin Cerdas' : 'Aktris & Edukator Cerdas'),
      faceShape: 'Oval',
      comment: isMale ? 'Tatapan ramah, berkarisma tinggi, dan berwawasan luas!' : 'Punya bentuk wajah proporsional dan aura cerdas berprestasi!',
      traits: ['Simetris proporsional', 'Ekspresi cerah positif', 'Karisma tinggi']
    };

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

function fetchWikiJson(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) HarkatPhotobooth/1.0' }, timeout: 4000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

function fetchBuffer(url) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }, timeout: 6000 }, (res) => {
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

async function getCelebImage(req, res, u) {
  const rawName = u.searchParams.get('name') || '';
  const cleanName = rawName.replace(/[\u{1F300}-\u{1FAFF}]/gu, '').replace(/[^\p{L}\p{N}\s.,-]/gu, '').trim();
  if (!cleanName) return json(res, 400, { error: 'name parameter required' });

  const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const cachedFile = path.join(CELEB_CACHE_DIR, `${slug}.jpg`);

  if (fs.existsSync(cachedFile)) {
    const buf = fs.readFileSync(cachedFile);
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': buf.length,
      'Cache-Control': 'public, max-age=604800',
      'Access-Control-Allow-Origin': '*'
    });
    return res.end(buf);
  }

  try {
    let summary = await fetchWikiJson(`https://id.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cleanName)}`);
    let imgUrl = summary?.thumbnail?.source || summary?.originalimage?.source;
    if (!imgUrl) {
      summary = await fetchWikiJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cleanName)}`);
      imgUrl = summary?.thumbnail?.source || summary?.originalimage?.source;
    }
    if (imgUrl) {
      const imgBuf = await fetchBuffer(imgUrl);
      if (imgBuf && imgBuf.length > 500) {
        try { fs.writeFileSync(cachedFile, imgBuf); } catch (_) {}
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Content-Length': imgBuf.length,
          'Cache-Control': 'public, max-age=604800',
          'Access-Control-Allow-Origin': '*'
        });
        return res.end(imgBuf);
      }
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