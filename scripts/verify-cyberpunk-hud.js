const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = '/snap/chromium/current/usr/lib/chromium-browser/chrome';
const OUT_DIR = '/root/harkat-photobooth/test-output';
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

async function verifyCyberpunkHud() {
  console.log('🚀 [Autonomous QA] Running Cyberpunk Biometric HUD UI Verification...');
  
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--window-size=430,932',
      '--device-scale-factor=2'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 });

  // 1. Initial State Screenshot
  console.log('📸 Capturing Initial HUD State...');
  await page.goto('http://127.0.0.1:8123/dev', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: path.join(OUT_DIR, 'hud_1_initial.png') });

  // 2. Trigger Scan & Capture Scanning State
  console.log('⚡ Triggering Scan Flow...');
  await page.click('#btnScan');
  await new Promise(r => setTimeout(r, 700));
  await page.screenshot({ path: path.join(OUT_DIR, 'hud_2_scanning.png') });

  // 3. Wait for Results & Capture Live Results Panel
  console.log('📊 Waiting for Live Results Panel...');
  await page.waitForFunction(() => {
    const panel = document.querySelector('#liveResultPanel');
    return panel && panel.style.display === 'flex';
  }, { timeout: 15000 });
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: path.join(OUT_DIR, 'hud_3_live_results.png'), fullPage: true });

  // 4. Open Modal & Capture Modal Preview
  console.log('🖼️ Opening Modal Preview...');
  await page.click('#btnLivePreview');
  await page.waitForFunction(() => document.querySelector('#modalResult').style.display === 'flex', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: path.join(OUT_DIR, 'hud_4_modal_certificate.png') });

  // 5. Extract Certificate PNG to disk
  const certDataUrl = await page.evaluate(() => document.querySelector('#certImg').src);
  if (certDataUrl && certDataUrl.startsWith('data:image/png;base64,')) {
    const base64Data = certDataUrl.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(path.join(OUT_DIR, 'hud_5_exported_cert.png'), base64Data, 'base64');
    console.log('💾 Exported Certificate PNG saved to disk!');
  }

  await browser.close();
  console.log('✅ Cyberpunk Biometric HUD UI Verification Complete!');
}

verifyCyberpunkHud().catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
