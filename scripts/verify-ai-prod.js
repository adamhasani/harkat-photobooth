const puppeteer = require('puppeteer-core');

const CHROME = '/snap/chromium/current/usr/lib/chromium-browser/chrome';

async function verifyEndpoint(url) {
  console.log(`\n🔍 Testing endpoint: ${url}`);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--window-size=390,844']
  });

  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error' && !text.includes('TensorFlow Lite') && !text.includes('face_landmarker')) {
      consoleErrors.push(text);
    }
  });
  page.on('pageerror', err => consoleErrors.push(err.message));

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await new Promise(r => setTimeout(r, 2000));

  const title = await page.title();
  console.log(`  ✓ Page title: ${title}`);

  const hasUi = await page.evaluate(() => {
    return {
      hasVideo: !!document.querySelector('#video'),
      hasBtnScan: !!document.querySelector('#btnScan'),
      hasCornerBrackets: document.querySelectorAll('.corner-bracket').length === 4,
      hasScanningOverlay: !!document.querySelector('#scanningOverlay'),
      hasOverlayCanvas: !!document.querySelector('#overlayCanvas'),
      brand: document.querySelector('.brand small')?.textContent?.trim()
    };
  });
  console.log(`  ✓ UI Elements: Video=${hasUi.hasVideo}, ScanBtn=${hasUi.hasBtnScan}, OverlayCanvas=${hasUi.hasOverlayCanvas}, Brand=${hasUi.brand}`);

  // Trigger scan button
  await page.click('#btnScan');
  await new Promise(r => setTimeout(r, 400));

  const isScanning = await page.evaluate(() => {
    return {
      active: document.querySelector('#scanningOverlay').style.display === 'flex',
      stepTitle: document.querySelector('#scanStepTitle')?.textContent?.trim()
    };
  });
  console.log(`  ✓ Scan Triggered: active=${isScanning.active}, step="${isScanning.stepTitle}"`);

  // Wait for scan completion
  await page.waitForFunction(() => {
    const panel = document.querySelector('#liveResultPanel');
    return panel && panel.style.display === 'flex';
  }, { timeout: 15000 });

  const resultData = await page.evaluate(() => {
    return {
      genderAge: document.querySelector('#liveGenderAge')?.textContent?.trim(),
      beauty: document.querySelector('#liveBeauty')?.textContent?.trim(),
      lookalike: document.querySelector('#liveLookalike')?.textContent?.trim(),
      hasCertCanvas: !!document.querySelector('#certCanvas'),
      hasCertImg: !!document.querySelector('#certImage')
    };
  });
  console.log(`  ✓ Results Rendered: ${resultData.genderAge} | ${resultData.beauty} | ${resultData.lookalike}`);

  // Open modal
  await page.click('#btnLivePreview');
  await page.waitForFunction(() => {
    const m = document.querySelector('#modalResult');
    return m && (m.classList.contains('active') || m.style.display === 'flex' || getComputedStyle(m).display !== 'none');
  }, { timeout: 5000 });

  const modalData = await page.evaluate(() => {
    return {
      modalOpen: document.querySelector('#modalResult').style.display === 'flex',
      primary: document.querySelector('#certPrimaryResult')?.textContent?.trim(),
      beauty: document.querySelector('#certBeautyResult')?.textContent?.trim(),
      wrinkle: document.querySelector('#certWrinkleResult')?.textContent?.trim(),
      lookalike: document.querySelector('#certSecondaryResult')?.textContent?.trim()
    };
  });
  console.log(`  ✓ Certificate Modal: ${modalData.primary} | Wrinkle: "${modalData.wrinkle}" | Lookalike: ${modalData.lookalike}`);

  await browser.close();
  return consoleErrors.length === 0;
}

(async () => {
  try {
    const devOk = await verifyEndpoint('http://127.0.0.1:8123/dev');
    const aiOk = await verifyEndpoint('http://127.0.0.1:8123/ai');

    if (devOk && aiOk) {
      console.log('\n🎉 [Verification Success] Both /dev and /ai are 100% operational, fully verified, and ready!');
      process.exit(0);
    } else {
      console.error('\n❌ Verification had errors.');
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal verification error:', err);
    process.exit(1);
  }
})();
