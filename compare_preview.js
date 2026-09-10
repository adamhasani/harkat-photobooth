// E2E: bandingkan DOM preview (CETAK tab) vs canvas sheet.png — pakai fake camera 4 foto
const puppeteer = require('puppeteer-core');
const CHROME = '/snap/chromium/current/usr/lib/chromium-browser/chrome';
const PORT = process.env.PORT || 8123;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox','--disable-setuid-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--window-size=430,900']
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1200));
  // aktifin kamera + 4 foto
  await page.click('#tabCam'); await new Promise(r => setTimeout(r, 200));
  for (let k = 0; k < 4; k++) { await page.click('#btnShoot'); await new Promise(r => setTimeout(r, 150)); }
  // Done -> layout (QR + captions + sheet
  await page.click('#btnDone'); await new Promise(r => setTimeout(r, 2500));

  // screenshot DOM layout panel (region .sheet)
  const panel = await page.$('#panel-layout');
  if (panel) await panel.screenshot({ path: '/tmp/dom_preview.png' });
  // canvas sheet dataURL -> save
  const du = await page.evaluate(() => window.__h.renderSheet(true));
  const b64 = du.split(',')[1];
  require('fs').writeFileSync('/tmp/canvas_sheet.png', Buffer.from(b64, 'base64'));
  console.log('saved DOM preview + canvas sheet');

  // juga QR DOM box screenshot
  const qrEl = await page.$('#qrBox');
  if (qrEl) await qrEl.screenshot({ path: '/tmp/qr_dom.png' });
  console.log('done');
  await browser.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });