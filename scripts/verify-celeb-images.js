const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CHROME = '/snap/chromium/current/usr/lib/chromium-browser/chrome';

async function testCelebImages() {
  console.log('Testing /ai celebrity image rendering...');
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--window-size=412,915']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true });

  await page.goto('http://127.0.0.1:8123/ai', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await new Promise(r => setTimeout(r, 1500));

  // Click scan button
  await page.click('#btnScan');
  console.log('Triggered #btnScan...');

  // Wait for result panel
  await page.waitForFunction(() => {
    const panel = document.querySelector('#liveResultPanel');
    return panel && (panel.style.display === 'flex' || panel.style.display === 'block');
  }, { timeout: 15000 });

  await new Promise(r => setTimeout(r, 1000));

  const celebInfo = await page.evaluate(() => {
    const celebImg = document.querySelector('#liveCelebPhoto');
    const celebTag = document.querySelector('#liveCelebNameTag');
    const matchPct = document.querySelector('#liveMatchPctText');
    return {
      celebSrc: celebImg?.src,
      naturalWidth: celebImg?.naturalWidth,
      naturalHeight: celebImg?.naturalHeight,
      complete: celebImg?.complete,
      tag: celebTag?.textContent,
      matchPct: matchPct?.textContent,
      isSvgFallback: celebImg?.src?.startsWith('data:image/svg')
    };
  });

  console.log('Celeb Info:', JSON.stringify(celebInfo, null, 2));

  // Take a screenshot of the results
  const screenshotPath = '/root/harkat-photobooth/test_result_celeb.png';
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log('Screenshot saved to:', screenshotPath);

  await browser.close();

  if (celebInfo.isSvgFallback || celebInfo.naturalWidth === 0) {
    console.error('FAIL: Celebrity image is still SVG fallback or not rendered!');
    process.exit(1);
  } else {
    console.log('SUCCESS: Real celebrity photo loaded and rendered cleanly!');
    process.exit(0);
  }
}

testCelebImages().catch(err => {
  console.error('Error during test:', err);
  process.exit(1);
});
