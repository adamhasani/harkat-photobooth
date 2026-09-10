// E2E v3: new capture flow — 1 click = 1 photo, stay in camera, Done button
const puppeteer = require('/usr/local/lib/node_modules/puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/snap/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-select-desktop-capture-source', '--window-size=420,900']
  });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('PAGEERROR:', e.message));
  await page.goto('http://127.0.0.1:8099/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 9000));

  // 1) camera: video playing, no canvas element anymore
  const camCheck = await page.evaluate(() => ({
    hasCanvas: !!document.querySelector('canvas'),
    hasHud: !!document.querySelector('#hud'),
    videoW: document.querySelector('#video').videoWidth,
    aspect: document.getElementById('camWrap').style.aspectRatio || '(not yet set)'
  }));

  // 2) shoot once: should STAY on camera tab (cam active), count 1
  await page.click('#btnShoot');
  await new Promise(r => setTimeout(r, 700));
  const after1 = await page.evaluate(() => ({
    activePanel: [...document.querySelectorAll('.panel')].find(p => p.classList.contains('active')).id,
    count: document.getElementById('countBox').textContent,
    toastOp: document.getElementById('toast').style.opacity,
    toastMsg: document.getElementById('toast').innerHTML
  }));

  // 3) shoot 3 more, still on camera
  for (let i = 0; i < 3; i++) { await page.click('#btnShoot'); await new Promise(r => setTimeout(r, 500)); }
  const after4 = await page.evaluate(() => ({
    activePanel: [...document.querySelectorAll('.panel')].find(p => p.classList.contains('active')).id,
    count: document.getElementById('countBox').textContent,
    boxesFilled: [...document.querySelectorAll('.box')].filter(b => b.querySelector('img')).length,
    distinct: new Set([...document.querySelectorAll('.box img')].map(i => i.src)).size
  }));

  // 4) Done button -> layout panel
  await page.click('#btnDone');
  await new Promise(r => setTimeout(r, 400));
  const afterDone = await page.evaluate(() => ({
    activePanel: [...document.querySelectorAll('.panel')].find(p => p.classList.contains('active')).id,
    printBtn: !!document.querySelector('#btnPrint')
  }));

  // 5) fill to 8, 9th click should NOT wrap to 0
  await page.click('#tabCam');
  for (let i = 0; i < 4; i++) { await page.click('#btnShoot'); await new Promise(r => setTimeout(r, 400)); }
  const full = await page.evaluate(() => ({
    count: document.getElementById('countBox').textContent,
    boxesFilled: [...document.querySelectorAll('.box')].filter(b => b.querySelector('img')).length
  }));
  await page.click('#btnShoot');
  await new Promise(r => setTimeout(r, 400));
  const full2 = await page.evaluate(() => ({
    count: document.getElementById('countBox').textContent,
    toastMsg: document.getElementById('toast').innerHTML
  }));

  console.log('CAM:', JSON.stringify(camCheck));
  console.log('AFTER1:', JSON.stringify(after1));
  console.log('AFTER4:', JSON.stringify(after4));
  console.log('DONE:', JSON.stringify(afterDone));
  console.log('FULL:', JSON.stringify(full), '-> 9th click:', JSON.stringify(full2));
  await page.screenshot({ path: '/root/harkat-photobooth/e2e_v3_cam.png' });
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });