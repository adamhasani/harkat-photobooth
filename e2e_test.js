// Headless E2E: fake camera (front/rear), capture JPEG, QR render+gallery, print-media styles.
const puppeteer = require('puppeteer-core');
const CHROME = '/snap/chromium/current/usr/lib/chromium-browser/chrome';
const PORT = process.env.PORT || 8123;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--window-size=390,844' // portrait phone
    ]
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1200));

  // 1. front camera: video playing + .mirror applied
  const front = await page.evaluate(() => ({
    hasVideo: !!document.querySelector('#video'),
    ready: document.querySelector('#video').readyState,
    mirror: document.querySelector('#video').classList.contains('mirror'),
    playing: !document.querySelector('#video').paused,
    camWrapAspect: document.querySelector('#camWrap').style.aspectRatio
  }));
  console.log('FRONT_CAM', JSON.stringify(front));

  // 2. flip to rear -> mirror removed
  await page.click('#btnFlip');
  await new Promise(r => setTimeout(r, 800));
  const rear = await page.evaluate(() => ({
    mirror: document.querySelector('#video').classList.contains('mirror')
  }));
  console.log('REAR_CAM', JSON.stringify(rear));

  // 3. flip back to front, shoot; verify JPEG capture + layout
  await page.click('#btnFlip');
  await new Promise(r => setTimeout(r, 800));
  await page.click('#btnShoot');
  await new Promise(r => setTimeout(r, 400));
  const shot = await page.evaluate(() => ({
    count: document.querySelector('#countBox').textContent,
    boxesFilled: [...document.querySelectorAll('.box img')].length,
    firstIsJpeg: (document.querySelector('.box img') || {}).src?.startsWith('data:image/jpeg')
  }));
  console.log('SHOT', JSON.stringify(shot));

  // 4. Done -> ensure gallery (POST /api/session) + sheet (POST /api/sheet) + QR svg rendered
  // (jalur user: buka tab CETAK langsung, bukan tombol Done — QR harus muncul juga)
  const seenPosts = []; const seenSheets = [];
  page.on('request', req => {
    if (req.method() !== 'POST') return;
    if (req.url().includes('/api/session')) seenPosts.push(req.postData());
    if (req.url().includes('/api/sheet')) seenSheets.push(req.postData());
  });
  await page.click('#btnReset');
  await new Promise(r => setTimeout(r, 300));
  await page.click('#tabCam');
  await page.click('#btnShoot');
  await new Promise(r => setTimeout(r, 400));
  await page.click('#tabLayout');
  await new Promise(r => setTimeout(r, 2200));
  const qr = await page.evaluate(() => ({
    qrBoxHidden: document.querySelector('#qrBox').hidden,
    hasSvg: !!document.querySelector('#qrBox svg'),
    link: document.querySelector('#galleryLink').textContent,
    linkHref: document.querySelector('#galleryLink').getAttribute('href')
  }));
  console.log('QR', JSON.stringify(qr));
  console.log('POST_SEEN', seenPosts.length, 'contains_jpeg:', seenPosts.length ? seenPosts[0].includes('data:image/jpeg') : false);
  const postPayload = seenPosts.length ? JSON.parse(seenPosts[0]) : null;
  console.log('POST_PHOTOS', postPayload ? postPayload.photos.length : 0);
  console.log('SHEET_SEEN', seenSheets.length, seenSheets.length ? 'png:' + seenSheets[0].includes('data:image/png') : '');
  const sheetPayload = seenSheets.length ? JSON.parse(seenSheets[0]) : null;
  if (sheetPayload) {
    const dl = await page.evaluate(async (id) => {
      const r = await fetch('/download/' + id);
      const buf = await r.arrayBuffer();
      return { status: r.status, cd: r.headers.get('content-disposition'), ct: r.headers.get('content-type'), bytes: buf.byteLength };
    }, sheetPayload.sessionId);
    console.log('DL_ENDPOINT', JSON.stringify(dl));
  }

  // 4b. sheet PNG asli: 8 kotak terisi + nomor gold + emoji kanan + QR ter-decode (scan-benar)
  const sheetGeo = await page.evaluate(async () => {
    const du = await window.__h.renderSheet(true);
    const img = new Image();
    img.src = du;
    await new Promise(res => img.onload = res);
    const W = 1080, PAD = 24, GAP = 10, HEAD = 88;
    const card = Math.floor((W - PAD * 2 - GAP) / 2);
    const yBody = PAD + HEAD + 10;
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const px = (xx, yy) => { const d = ctx.getImageData(xx, yy, 1, 1).data; return [d[0], d[1], d[2]]; };
    const isCream = p => Math.abs(p[0]-245) < 30 && Math.abs(p[1]-236) < 30 && Math.abs(p[2]-207) < 30;
    const filled = [], golds = [];
    for (let r = 0; r < 4; r++) for (let col = 0; col < 2; col++) {
      const cx = PAD + col * (card + GAP) + card / 2, cy = yBody + r * (card + GAP) + card / 2;
      filled.push(isCream(px(cx, cy)) ? 0 : 1);
      const gx = PAD + col * (card + GAP) - 16 + 8, gy = yBody + r * (card + GAP) - 16 + 29;
      const g = px(gx, gy); golds.push((g[0] > 170 && g[1] > 120 && g[2] < 110) ? 1 : 0);
    }
    return { w: img.width, h: img.height, filled, golds };
  });
  console.log('SHEET_GEO', JSON.stringify(sheetGeo));
  // decode QR dari /download PNG (jsqr)
  const dlRes = await page.evaluate(async (id) => {
    const r = await fetch('/download/' + id); const buf = await r.arrayBuffer();
    // chunked -> String.fromCharCode, biar gak overflow call stack di payload besar
    const u8 = new Uint8Array(buf); let bin = '';
    const CH = 8192;
    for (let i = 0; i < u8.length; i += CH) bin += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return { status: r.status, bytes: buf.byteLength, b64: btoa(bin) };
  }, sheetPayload.sessionId);
  const { PNG } = require('pngjs');
  const jsQR = require('jsqr');
  const fs = require('fs');
  fs.writeFileSync('/tmp/dl_sheet.png', Buffer.from(dlRes.b64, 'base64'));
  const png = PNG.sync.read(Buffer.from(dlRes.b64, 'base64'));
  const dec = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  console.log('QR_DECODE', JSON.stringify({ found: !!dec, data: dec && dec.data, size: `${png.width}x${png.height}` }));

  // 5. print media styles
  await page.emulateMediaType('print');
  const printStyles = await page.evaluate(() => {
    const qrBox = document.querySelector('#qrBox');
    const img = document.querySelector('.box img');
    return {
      qrDisplay: getComputedStyle(qrBox).display,
      imgOpacity: getComputedStyle(img).opacity,
      imgVisibility: getComputedStyle(img).visibility,
      toolbar: getComputedStyle(document.querySelector('.toolbar')).display
    };
  });
  await page.emulateMediaType('screen');
  console.log('PRINT', JSON.stringify(printStyles));

  // 6. emoji random (bukan custom SVG face) di badge + caption, downloadSheet masih jalan
  // buat 4 foto kasek biar tiap emoji unik (anti-repeat) ter-verifikasi
  await page.click('#tabCam');
  await new Promise(r => setTimeout(r, 300));
  await page.click('#btnReset');
  await new Promise(r => setTimeout(r, 300));
  for (let k = 0; k < 4; k++) { await page.click('#btnShoot'); await new Promise(r => setTimeout(r, 150)); }
  const faceCheck = await page.evaluate(() => {
    const emojiRe = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    const badges = [...document.querySelectorAll('.box .e')].map(e => e.textContent).filter(Boolean);
    return {
      badgeEmoji: badges.some(e => emojiRe.test(e)),
      badgeUnique: new Set(badges).size,
      badgeCount: badges.length,
      badgeSvgCount: document.querySelectorAll('.box .e svg').length,
      capFaceEmoji: [...document.querySelectorAll('.cap-line .cap-face')].some(e => emojiRe.test(e.textContent))
    };
  });
  console.log('FACE_EMOJI', JSON.stringify(faceCheck));

  await page.evaluate(() => { window.__test_dl = window.__h.downloadSheet; });
  await page.evaluate(() => {
    const origClick = HTMLAnchorElement.prototype.click;
    let got = null;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download && this.download.endsWith('.png')) got = this.download;
      return;
    };
    window.__test_dl().then(() => {
      HTMLAnchorElement.prototype.click = origClick;
      window.__test_result = got;
    }).catch(e => { window.__test_result = 'ERR ' + e.message; });
    return 'started';
  });
  await new Promise(r => setTimeout(r, 2500));
  const dlResult = await page.evaluate(() => window.__test_result);
  console.log('DOWNLOAD', JSON.stringify(dlResult));

  console.log('JS_ERRORS', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('E2E_FAIL', e.message); process.exit(1); });