const puppeteer = require('/root/harkat-photobooth/node_modules/puppeteer-core');
const CHROME = '/snap/chromium/current/usr/lib/chromium-browser/chrome';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  
  await page.goto('http://127.0.0.1:8123/dev2', { waitUntil: 'networkidle0' });
  
  // Click Cetak tab
  await page.click('#tabLayout');
  await new Promise(r => setTimeout(r, 400));
  
  // Scroll panel-layout to bottom
  await page.evaluate(() => {
    const el = document.getElementById('panel-layout');
    if (el) el.scrollTop = el.scrollHeight;
  });
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: '/root/harkat-photobooth/test-output/mobile_dev2_layout_scrolled.png' });

  await browser.close();
  console.log('Scrolled screenshot saved');
})().catch(err => { console.error(err); process.exit(1); });
