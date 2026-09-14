const puppeteer = require('/root/harkat-photobooth/node_modules/puppeteer-core');
const CHROME = '/snap/chromium/current/usr/lib/chromium-browser/chrome';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  
  await page.goto('http://127.0.0.1:8123/', { waitUntil: 'networkidle0' });
  await page.screenshot({ path: '/root/harkat-photobooth/test-output/mobile_landing_index.png' });

  await browser.close();
  console.log('Landing page screenshot saved');
})().catch(err => { console.error(err); process.exit(1); });
