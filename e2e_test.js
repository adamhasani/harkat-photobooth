// Headless E2E: fake camera (front/rear), capture JPEG, QR render+gallery, print-media styles.
const puppeteer = require('puppeteer-core');
const CHROME = '/snap/chromium/current/usr/lib/chromium-browser/chrome';

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

  await page.goto('http://127.0.0.1:8123/', { waitUntil: 'networkidle0', timeout: 30000 });
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

  // 4. Done -> ensure gallery (POST /api/session) + QR svg rendered
  const seenPosts = [];
  page.on('request', req => { if (req.method() === 'POST' && req.url().includes('/api/session')) seenPosts.push(req.postData()); });
  await page.click('#btnDone');
  await new Promise(r => setTimeout(r, 1200));
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

  // 6. gallery URL valid (from QR link)
  if (qr.linkHref) {
    const resp = await page.goto('http://127.0.0.1:8123' + qr.linkHref, { waitUntil: 'networkidle0' });
    const body = await page.evaluate(() => ({ imgs: document.querySelectorAll('img').length, title: document.title }));
    console.log('GALLERY_PAGE', resp.status(), JSON.stringify(body));
  }

  console.log('JS_ERRORS', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('E2E_FAIL', e.message); process.exit(1); });