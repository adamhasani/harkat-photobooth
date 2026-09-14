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
  await page.screenshot({ path: '/root/harkat-photobooth/test-output/mobile_dev2_step1.png' });
  
  const dimensions = await page.evaluate(() => {
    return {
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
      clientWidth: document.documentElement.clientWidth,
      appWidth: document.querySelector('.app') ? document.querySelector('.app').offsetWidth : null,
      appHeight: document.querySelector('.app') ? document.querySelector('.app').offsetHeight : null
    };
  });
  console.log('dev2 dimensions:', JSON.stringify(dimensions));
  
  // Find tab buttons
  const tabs = await page.$$('.tab-btn');
  console.log('Found tabs:', tabs.length);
  if (tabs.length > 1) {
    await tabs[1].click();
    await new Promise(r => setTimeout(r, 600));
    await page.screenshot({ path: '/root/harkat-photobooth/test-output/mobile_dev2_tabStrip.png' });
  }

  await browser.close();
  console.log('Screenshots captured successfully');
})().catch(err => { console.error(err); process.exit(1); });
