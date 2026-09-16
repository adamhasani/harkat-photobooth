// ai_accuracy_engine.js — High-Accuracy AI Vision & Biometrics Engine
// Implements:
// 1. Dynamic Biometric Few-Shot Grounding (DSPy-inspired)
// 2. Multi-Step Chain-of-Thought with Self-Critique & Verification (Reflexion-inspired)
// 3. Strict Schema Validation, Sanity Guardrails & Auto-Repair (Instructor-inspired)
// 4. Multi-Model Resilient Fallback Pipeline (OmniRoute Gemini 3.5/3.7 -> Groq -> Local Biometrics)

'use strict';
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { findBestLookalike, CELEBS_DATABASE_1000 } = require('./assets/data/celebs_database.js');

// Fast Map for O(1) Celeb Lookup & Gender Verification
const CELEB_MAP = new Map();
if (Array.isArray(CELEBS_DATABASE_1000)) {
  CELEBS_DATABASE_1000.forEach(c => {
    if (c && c.name) {
      const norm = c.name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      if (norm) CELEB_MAP.set(norm, c);
    }
  });
}

function findCelebInDb(name) {
  if (!name || typeof name !== 'string') return null;
  const norm = name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  if (CELEB_MAP.has(norm)) return CELEB_MAP.get(norm);
  for (const [k, v] of CELEB_MAP.entries()) {
    if (k.includes(norm) || norm.includes(k)) return v;
  }
  return null;
}

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

let geminiKeyIdx = 0;

// Keys ONLY from env or ~/gemini_keys.txt (never hardcoded in the repo).
function getGeminiKeys() {
  const keys = [];
  try {
    if (process.env.GEMINI_API_KEYS) {
      for (const k of process.env.GEMINI_API_KEYS.split(/[,\s]+/)) {
        if (k && !keys.includes(k)) keys.push(k);
      }
    }
    const keyFile = path.join(os.homedir(), 'gemini_keys.txt');
    if (fs.existsSync(keyFile)) {
      const lines = fs.readFileSync(keyFile, 'utf8')
        .split('\n')
        .map(s => s.trim())
        .filter(s => s && s.startsWith('AQ.'));
      for (const k of lines) {
        if (!keys.includes(k)) keys.push(k);
      }
    }
  } catch (_) {}
  return keys;
}

const DEV_SYSTEM_PROMPT = `Kamu adalah Sistem AI Computer Vision & Biometric Craniofacial Analyzer presisi tinggi dengan kapabilitas Real-Time Public Figure Recognition & Face Matching.

MISI UTAMA:
Lakukan analisis visual & biometrik wajah secara SANGAT TELITI, OBJEKTIF, REALISTIS, dan AKURAT.

LANGKAH 1 — VERIFIKASI KEASLIAN IDENTITAS (APAKAH FOTO RESMI/ASLI ARTIS/TOKOH NYATA?):
Periksa apakah foto ini adalah foto asli/resmi/dokumentasi dari seorang ARTIS, MUSISI, AKTOR/AKTRIS, ATLET, CREATOR, ATAU TOKOH PUBLIK NYATA — baik yang SANGAT TERKENAL (mainstream papan atas seperti Afgan, Reza Rahadian, Agnez Mo, Jefri Nichol, Dian Sastro) maupun ARTIS INDIE / NICHE / LESS KNOWN (seperti Jason Ranti, Sal Priadi, Danilla Riyadi, Baskara Putra, Cholil Mahmud, Bilal Indrajaya, dsb).
- Jika 'isSelfArtist: true': HANYA dan MUTLAK jika kamu yakin dengan kepastian tinggi bahwa subjek dalam foto ini MEMANG adalah tokoh/artis tersebut (bukan orang biasa yang mirip).
  * 'lookalike': Nama Lengkap / Panggung Resmi Tokoh tersebut
  * 'lookalikeRole': Profesi & karya ikonik singkatnya (max 4-5 kata)
  * 'lookalikeMatch': 99 atau 100 (karena memang foto asli dirinya sendiri)
  * 'comment': Apresiasi karya/persona asli tokoh tersebut (10-14 kata).

- Jika 'isSelfArtist: false': JIKA INI ORANG BIASA, PENGUNJUNG PHOTOBOOTH, ATAU MODEL BIASA:
  * JANGAN sekali-kali klaim dia adalah artis tersebut!
  * Cari figur publik nyata di internet/dunia hiburan/tokoh inspiratif yang PALING MIRIP secara proporsi bentuk wajah, hidung, mata, dan senyumnya.
  * BEBAS GENDER (Gender-Agnostic Matching): JANGAN batasi kembaran berdasarkan gender! Cocokkan murni berdasarkan struktur tulang kraniofasial, mata, hidung, kontur rahang, dan garis senyum. Subjek perempuan bisa dipadankan dengan tokoh pria, dan subjek pria bisa dipadankan dengan tokoh wanita jika proporsi wajahnya memang identik dan sangat mirip. Kemiripan visual nyata adalah prioritas mutlak agar orang merasa 'wah mirip banget!'.
  * 'lookalikeMatch': 88 - 96 (karena hanya mirip, bukan orang yang sama).

LANGKAH 2 — OBSERVASI BUKTI BIOMETRIK & USIA BIOLOGIS:
- Gender: 'Laki-laki 👦' atau 'Perempuan 👧' (wajib 100% akurat; hijab/kerudung/ciput = Perempuan 👧).
- Usia biologis nyata: hitung secara realistis dari kerutan dahi, crow's feet sudut mata, dan garis tawa nasolabial (15-85 tahun). Dilarang selalu menebak usia 19-21 jika ada tanda kerutan nyata!
- Face Shape: Oval / Square / Angular / Heart / Round / Diamond / Oblong.
- Wrinkle Analysis: Frasa ringkas max 3-4 kata + 1 emoji (misal: 'Kulit Halus & Kencang ✨' atau 'Garis Tawa Matang Karismatik 🌟').

LANGKAH 3 — REFLEXION & SELF-CRITIQUE:
Sebelum mengeluarkan JSON, verifikasi bahwa:
1. Kemiripan struktur visual wajah nyata dan meyakinkan (fokus pada fitur wajah objektif tanpa batasan gender).
2. Usia figur publik harmonis dengan rentang usia subjek.
3. Figur publik adalah orang nyata yang dapat dicari di Google/Wikipedia (bukan fiktif).

FORMAT KELUARAN (HANYA JSON VALID TANPA TEKS LAIN):
{
  "reflexion_critique": {
    "is_self_artist_check": "<penjelasan apakah ini foto asli artis nyata atau orang biasa>",
    "hair_and_headwear": "<deskripsi rambut/hijab/kumis>",
    "skin_and_wrinkle_markers": "<deskripsi dahi, sudut mata, garis tawa>",
    "age_verification": "<alasan estimasi usia>",
    "lookalike_facial_features_match": "<alasan kemiripan bentuk mata, rahang, senyum>"
  },
  "verified_result": {
    "isSelfArtist": <true/false>,
    "artistDetectionNote": "<penjelasan identifikasi singkat>",
    "gender": "Laki-laki 👦" atau "Perempuan 👧",
    "age": <integer 15-85>,
    "generation": "<Gen-Z Fresh 🎓 / Gen-Z Active 🌟 / Milenial Leader 💼 / Prime Leader 🏛️ / Senior Mentor 📚 / Maestro Kehormatan 👑>",
    "faceShape": "<Oval / Square / Angular / Round / Soft / Heart / V-Shape / Diamond / Chiseled / Oblong / Regal>",
    "beautyScore": <integer 88-99>,
    "symmetryScore": <integer 88-99>,
    "wrinkleAnalysis": "<Frasa ringkas max 3-4 kata + 1 emoji>",
    "lookalike": "<Nama Lengkap Figur Publik>",
    "lookalikeRole": "<Profesi/julukan singkat max 3-4 kata>",
    "lookalikeMatch": <integer 88-100>,
    "majorVibe": "<Vibe dominan>",
    "comment": "<1 kalimat tajam & personal max 10-14 kata>",
    "facialTraits": "<3 ciri fisik terdeteksi, pisahkan koma>"
  }
}`;

function buildGroundedPrompt(telemetry) {
  let telemetryText = 'Lakukan analisis biometrik wajah & estimasi umur biologis dari foto ini secara presisi dan objektif:';
  if (!telemetry) return telemetryText;

  telemetryText = `=== PENGUKURAN SENSOR BIOMETRIK CRANIOFACIAL 3D ===
- Bentuk Wajah Terukur: ${telemetry.faceShape || 'Oval'}
- Simetri Wajah: ${telemetry.symmetryPct || 95}%
- Intensitas Senyuman: ${telemetry.smilePct || 80}%
- Rasio Rahang (Jaw Ratio): ${(telemetry.jawRatio || 0.55).toFixed ? (telemetry.jawRatio || 0.55).toFixed(3) : telemetry.jawRatio}
- Rasio Dagu (Chin Ratio): ${(telemetry.chinRatio || 0.62).toFixed ? (telemetry.chinRatio || 0.62).toFixed(3) : telemetry.chinRatio}
- Rasio Mata (Eye Ratio): ${(telemetry.eyeRatio || 0.38).toFixed ? (telemetry.eyeRatio || 0.38).toFixed(3) : telemetry.eyeRatio}
- Indeks Ketegangan Wajah (Wrinkle Tension): ${(telemetry.wrinkleTension || 0.20).toFixed ? (telemetry.wrinkleTension || 0.20).toFixed(3) : telemetry.wrinkleTension}
- Rasio Dahi: ${(telemetry.foreheadRatio || 0.30).toFixed ? (telemetry.foreheadRatio || 0.30).toFixed(3) : telemetry.foreheadRatio}

INSTRUKSI PENTING:
1. Mulai dengan 'reflexion_critique' untuk memvalidasi bukti visual struktur kraniofasial, kerutan kulit, dan proporsi bentuk wajah.
2. Tentukan figur publik ternama dunia atau Indonesia (aktor, musisi, atlet, creator, figur inspiratif) yang PALING MIRIP secara objektif dengan proporsi bentuk wajah subjek (bebas batasan gender, prioritaskan kemiripan fitur mata, rahang, hidung, senyum).
3. Pastikan hasil akhir 'verified_result' menonjolkan kemiripan visual kraniofasial tertinggi agar subjek merasa 'wah mirip banget'!`;

  return telemetryText;
}

// Strict Schema Guardrails & Auto-Repair (Instructor-inspired)
function validateAndRepairAiResult(rawResult, telemetry) {
  let data = (rawResult && rawResult.verified_result) ? rawResult.verified_result : (rawResult || {});

  // 1. Gender Verification & Correction
  let isSubjectMale = true;
  if (telemetry) {
    if (typeof telemetry.isLikelyMale === 'boolean') {
      isSubjectMale = telemetry.isLikelyMale;
    } else if (String(telemetry.gender || '').toLowerCase().startsWith('perem')) {
      isSubjectMale = false;
    }
  }

  // Cross-check with critique if available
  const critique = (rawResult && rawResult.reflexion_critique) ? rawResult.reflexion_critique : null;
  if (critique) {
    const hairText = String(critique.hair_and_headwear || '').toLowerCase();
    const gCheckText = String(critique.gender_verification || '').toLowerCase();
    if (hairText.includes('hijab') || hairText.includes('kerudung') || hairText.includes('jilbab') || gCheckText.includes('perempuan')) {
      isSubjectMale = false;
    }
  }

  let finalGender = isSubjectMale ? 'Laki-laki 👦' : 'Perempuan 👧';
  if (data.gender) {
    const gStr = String(data.gender).toLowerCase();
    if (gStr.includes('perem') || gStr.includes('wanita') || gStr.includes('female')) {
      finalGender = 'Perempuan 👧';
      isSubjectMale = false;
    } else if (gStr.includes('laki') || gStr.includes('pria') || gStr.includes('male')) {
      if (!isSubjectMale && (critique && String(critique.hair_and_headwear).toLowerCase().includes('hijab'))) {
        finalGender = 'Perempuan 👧'; // Enforce hijab rule
      } else {
        finalGender = 'Laki-laki 👦';
        isSubjectMale = true;
      }
    }
  }

  // 2. Age & Generation Verification & Strict Synchronization
  let age = Math.round(Number(data.age) || (telemetry && telemetry.estAge) || 22);
  const sensorAge = (telemetry && typeof telemetry.estAge === 'number') ? telemetry.estAge : 22;
  const wrinkleTension = (telemetry && typeof telemetry.wrinkleTension === 'number') ? telemetry.wrinkleTension : 0.20;

  // Cross-calibrate with physical sensor wrinkle tension
  if (wrinkleTension < 0.20 && age > 40) {
    // Sensor shows smooth taut skin with low tension, but LLM guessed elderly
    age = Math.round((age * 0.3) + (sensorAge * 0.7));
  } else if (wrinkleTension > 0.35 && age < 30) {
    // Sensor shows deep wrinkles/tension, but LLM guessed teenage
    age = Math.round((age * 0.3) + (sensorAge * 0.7));
  }

  if (isNaN(age) || age < 15) age = 17;
  if (age > 85) age = 80;

  let generation = 'Gen-Z Active 🌟';
  if (age <= 19) generation = 'Gen-Z Fresh 🎓';
  else if (age <= 27) generation = 'Gen-Z Active 🌟';
  else if (age <= 39) generation = 'Milenial Leader 💼';
  else if (age <= 54) generation = 'Prime Leader 🏛️';
  else if (age <= 69) generation = 'Senior Mentor 📚';
  else generation = 'Maestro Kehormatan 👑';

  // 3. Face Shape
  const validShapes = ['Oval', 'Square / Angular', 'Heart / V-Shape', 'Diamond / Chiseled', 'Round / Soft', 'Oblong / Regal'];
  let faceShape = data.faceShape || (telemetry && telemetry.faceShape) || 'Oval';
  const matchedShape = validShapes.find(s => s.toLowerCase().includes(String(faceShape).toLowerCase().split(' ')[0]));
  if (matchedShape) faceShape = matchedShape;

  // 4. Scores Clamping (88 - 99)
  let beautyScore = Math.round(Number(data.beautyScore) || (telemetry && telemetry.beautyScore) || 95);
  beautyScore = Math.max(88, Math.min(99, beautyScore));

  let symmetryScore = Math.round(Number(data.symmetryScore) || (telemetry && telemetry.symmetryPct) || 95);
  symmetryScore = Math.max(88, Math.min(99, symmetryScore));

  const isSelfArtist = Boolean(data.isSelfArtist);
  let lookalikeMatch = Math.round(Number(data.lookalikeMatch) || (isSelfArtist ? 100 : 94));
  if (isSelfArtist) {
    lookalikeMatch = Math.max(98, Math.min(100, lookalikeMatch));
  } else {
    lookalikeMatch = Math.max(88, Math.min(96, lookalikeMatch));
  }

  // 5. Wrinkle Analysis (Punchy Copywriting: max 3-4 words + emoji)
  let wrinkleAnalysis = String(data.wrinkleAnalysis || (telemetry && telemetry.wrinkleLabel) || 'Kulit Halus & Kencang ✨').replace(/[\r\n]+/g, ' ').trim();
  if (wrinkleAnalysis.length > 32) {
    const parts = wrinkleAnalysis.split(/[.,;:|\-]/);
    if (parts[0] && parts[0].trim().length >= 4 && parts[0].trim().length <= 32) {
      wrinkleAnalysis = parts[0].trim();
    } else {
      wrinkleAnalysis = wrinkleAnalysis.slice(0, 30).trim() + ' ✨';
    }
  }

  // 6. Lookalike Celebrity Verification & Open-Ended Knowledge Support
  let rawLookalike = String(data.lookalike || '').trim();
  let lookalikeName = rawLookalike.replace(/[\u{1F300}-\u{1FAFF}]/gu, '').replace(/[^\p{L}\p{N}\s.,-]/gu, '').trim();

  let matchedCeleb = null;
  if (lookalikeName && lookalikeName.length >= 3) {
    if (isSelfArtist) {
      // Confirmed self-artist: always prioritize their true identity
      matchedCeleb = {
        name: lookalikeName,
        role: data.lookalikeRole || 'Artis & Figur Publik Ternama',
        comment: data.comment || 'Pesona otentik dan karya orisinal berkarisma tinggi!',
        traits: data.facialTraits ? [data.facialTraits] : ['Wajah otentik', 'Karisma kuat', 'Karakter khas']
      };
    } else {
      const inDb = findCelebInDb(lookalikeName);
      if (inDb) {
        // Bebas batasan gender: terima figur publik dari DB murni berdasarkan kemiripan wajah
        matchedCeleb = inDb;
      } else {
        // Open-ended public figure from AI vision (not restricted to DB)
        matchedCeleb = {
          name: lookalikeName,
          role: data.lookalikeRole || 'Figur Publik Ternama',
          comment: data.comment || 'Proporsi wajah simetris dengan ekspresi positif & berkarisma!',
          traits: data.facialTraits ? [data.facialTraits] : ['Simetris proporsional', 'Ekspresi positif', 'Berkarisma']
        };
      }
    }
  }

  // Fallback to biometric DB only if AI didn't provide a valid lookalike (bebas filter gender)
  if (!matchedCeleb) {
    try {
      const bioMatch = findBestLookalike(telemetry || {}, {
        gender: null, // Bebas filter gender agar kemiripan wajah murni dan maksimal
        age: age,
        topK: 10,
        randomizeTop: false
      });
      if (bioMatch && bioMatch.bestMatch) {
        matchedCeleb = bioMatch.bestMatch;
      }
    } catch (_) {}
  }

  // Final emergency fallback if still null
  if (!matchedCeleb) {
    matchedCeleb = { name: 'Maudy Ayunda 🎓', role: 'Aktris & Edukator Cerdas', comment: 'Struktur wajah simetris dengan ekspresi cerdas dan anggun!', traits: ['Proporsi seimbang', 'Senyum anggun', 'Tatapan cerdas'] };
  }

  const finalLookalike = matchedCeleb.name;
  let finalLookalikeRole = String(data.lookalikeRole || matchedCeleb.role || 'Figur Publik Inspiratif').trim();
  if (finalLookalikeRole.length > 40) finalLookalikeRole = finalLookalikeRole.slice(0, 38).trim() + '...';

  // 7. Comment & Personality Vibe
  let comment = String(data.comment || matchedCeleb.comment || 'Tatapan tajam dan struktur wajah simetris penuh karisma!').replace(/[\r\n]+/g, ' ').replace(/^["'«“]+|["'»”]+$/g, '').trim();
  if (comment.length > 85) {
    const s = comment.split(/(?<=[.!?])\s+/);
    if (s[0] && s[0].length <= 85 && s[0].length >= 10) comment = s[0];
    else comment = comment.slice(0, 80).trim() + '...';
  }

  const majorVibe = String(data.majorVibe || 'Sains Data & AI').trim();
  const facialTraits = data.facialTraits || (Array.isArray(matchedCeleb.traits) ? matchedCeleb.traits.join(', ') : 'Simetris proporsional, Ekspresi positif, Berkarisma');

  return {
    isSelfArtist: isSelfArtist,
    artistDetectionNote: data.artistDetectionNote || (isSelfArtist ? 'Artis teridentifikasi secara akurat.' : null),
    gender: finalGender,
    age: age,
    generation: generation,
    faceShape: faceShape,
    beautyScore: beautyScore,
    symmetryScore: symmetryScore,
    wrinkleAnalysis: wrinkleAnalysis,
    lookalike: finalLookalike,
    lookalikeRole: finalLookalikeRole,
    lookalikeMatch: lookalikeMatch,
    majorVibe: majorVibe,
    comment: comment,
    facialTraits: facialTraits,
    verification: {
      engine: 'Reflexion-Instructor-DSPy-v2',
      verified: true,
      critique: critique || null
    }
  };
}

async function callGeminiPoolVision(photo, telemetry) {
  const keys = getGeminiKeys();
  if (!keys.length) return null;

  const m = /^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/.exec(photo);
  if (!m) return null;
  const mimeType = m[1];
  const base64Data = m[2];

  const telemetryPrompt = buildGroundedPrompt(telemetry);
  const models = ['gemini-3.6-flash', 'gemini-3-flash-preview'];

  const payload = JSON.stringify({
    contents: [
      {
        parts: [
          { text: telemetryPrompt },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Data
            }
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2500,
      responseMimeType: 'application/json'
    }
  });

  const totalKeys = keys.length;
  for (let attempt = 0; attempt < totalKeys; attempt++) {
    const key = keys[(geminiKeyIdx + attempt) % totalKeys];

    for (const model of models) {
      const parsedJson = await new Promise((resolve) => {
        let isDone = false;
        const done = (val) => {
          if (!isDone) {
            isDone = true;
            resolve(val);
          }
        };

        const timer = setTimeout(() => done(null), 10000);

        try {
          const proxyReq = http.request({
            host: '127.0.0.1',
            port: 40080,
            method: 'CONNECT',
            path: 'generativelanguage.googleapis.com:443',
            timeout: 4000
          });

          proxyReq.on('connect', (res, socket) => {
            if (res.statusCode !== 200) {
              clearTimeout(timer);
              return done(null);
            }

            const req = https.request({
              host: 'generativelanguage.googleapis.com',
              path: `/v1beta/models/${model}:generateContent?key=${key}`,
              method: 'POST',
              socket: socket,
              agent: false,
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
              },
              timeout: 8500
            }, (resp) => {
              let buf = '';
              resp.on('data', c => buf += c);
              resp.on('end', () => {
                clearTimeout(timer);
                if (resp.statusCode === 200) {
                  try {
                    const json = JSON.parse(buf);
                    const text = json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts && json.candidates[0].content.parts[0].text;
                    if (text) {
                      const match = /\{[\s\S]*\}/.exec(text);
                      if (match) {
                        return done(JSON.parse(match[0]));
                      }
                    }
                  } catch (_) {}
                }
                done(null);
              });
            });

            req.on('error', () => { clearTimeout(timer); done(null); });
            req.on('timeout', () => { req.destroy(); clearTimeout(timer); done(null); });
            req.write(payload);
            req.end();
          });

          proxyReq.on('error', () => { clearTimeout(timer); done(null); });
          proxyReq.on('timeout', () => { proxyReq.destroy(); clearTimeout(timer); done(null); });
          proxyReq.end();
        } catch (_) {
          clearTimeout(timer);
          done(null);
        }
      });

      if (parsedJson) {
        geminiKeyIdx = (geminiKeyIdx + attempt + 1) % totalKeys;
        const verified = validateAndRepairAiResult(parsedJson, telemetry);
        return verified;
      }
    }
  }

  return null;
}

async function callDevVisionModel(photo, telemetry) {
  const key = getOmniRouteKey();
  if (!key) return null;

  const telemetryPrompt = buildGroundedPrompt(telemetry);
  const models = ['agy/gemini-2.5-flash', 'agy/gemini-3.7-flash-low'];

  for (const model of models) {
    const payload = JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: DEV_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: telemetryPrompt },
            { type: 'image_url', image_url: { url: photo } }
          ]
        }
      ],
      max_tokens: 750,
      temperature: 0.1
    });

    const parsedJson = await new Promise((resolve) => {
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
        timeout: 12000
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
                  return resolve(data);
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

    if (parsedJson) {
      // Validate and repair with strict schema guardrail
      const verified = validateAndRepairAiResult(parsedJson, telemetry);
      return verified;
    }
  }

  return null;
}

// Fallback using high-precision local morphometrics & 1,000 DB
function getLocalBiometricFallback(telemetry) {
  const isSubjectMale = telemetry ? (typeof telemetry.isLikelyMale === 'boolean' ? telemetry.isLikelyMale : String(telemetry.gender || '').startsWith('Laki')) : true;
  const estAge = (telemetry && telemetry.estAge) || 22;

  let match = null;
  try {
    match = findBestLookalike(telemetry || {}, {
      gender: null, // Bebas filter gender agar kemiripan wajah murni
      age: estAge,
      topK: 10,
      randomizeTop: false
    });
  } catch (_) {}

  const bestCeleb = (match && match.bestMatch) || {
    name: 'Iqbaal Ramadhan 🎸',
    role: 'Aktor & Musisi Cerdas',
    comment: 'Struktur wajah simetris proporsional dengan aura karismatik!',
    traits: ['Simetris proporsional', 'Ekspresi cerdas', 'Berkarisma']
  };

  const rawFallback = {
    gender: isSubjectMale ? 'Laki-laki 👦' : 'Perempuan 👧',
    age: estAge,
    faceShape: (telemetry && telemetry.faceShape) || bestCeleb.faceShape || 'Oval',
    beautyScore: (telemetry && telemetry.beautyScore) || 94,
    symmetryScore: (telemetry && telemetry.symmetryPct) || 95,
    wrinkleAnalysis: (telemetry && telemetry.wrinkleLabel) || 'Kulit Halus & Kencang ✨',
    lookalike: bestCeleb.name,
    lookalikeRole: bestCeleb.role,
    lookalikeMatch: (match && match.matchPct) || 95,
    majorVibe: 'Sains Data & AI',
    comment: bestCeleb.comment || 'Tatapan tajam dan proporsi wajah simetris penuh karisma!',
    facialTraits: Array.isArray(bestCeleb.traits) ? bestCeleb.traits.join(', ') : 'Simetris proporsional, Ekspresi positif, Berkarisma'
  };

  return validateAndRepairAiResult(rawFallback, telemetry);
}

// Main handler for /api/dev-ai-analyze
async function analyzeFaceWithAiDev(req, res, jsonHelper) {
  let raw = '';
  req.on('data', (c) => raw += c);
  req.on('end', async () => {
    let body;
    try { body = JSON.parse(raw); } catch (e) { return jsonHelper(res, 400, { error: 'bad json' }); }

    const photo = String(body.photo || '');
    const telemetry = body.telemetry || null;

    if (!photo.startsWith('data:image/')) {
      return jsonHelper(res, 400, { error: 'photo dataURL required' });
    }

    // 1. Primary: OmniRoute Reflexion Vision Pipeline (agy/gemini-2.5-flash / gemini-3.7-flash-low)
    let aiData = await callDevVisionModel(photo, telemetry);
    let provider = 'omniroute-vision-verified';

    // 2. Secondary: Gemini Multimodal Flash Pool (3 keys round-robin)
    if (!aiData) {
      aiData = await callGeminiPoolVision(photo, telemetry);
      if (aiData) provider = 'gemini-pool-3.6-flash';
    }

    // 3. Tertiary: Local Biometric Fallback with strict schema guardrail
    if (!aiData) {
      aiData = getLocalBiometricFallback(telemetry);
      provider = 'local-biometric-ensemble';
    }

    return jsonHelper(res, 200, {
      ok: true,
      provider,
      ai: aiData,
      data: aiData
    });
  });
}

module.exports = {
  analyzeFaceWithAiDev,
  validateAndRepairAiResult,
  buildGroundedPrompt,
  callGeminiPoolVision,
  callDevVisionModel,
  getLocalBiometricFallback,
  findCelebInDb
};
