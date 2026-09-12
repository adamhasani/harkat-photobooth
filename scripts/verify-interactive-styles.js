const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = '/snap/chromium/current/usr/lib/chromium-browser/chrome';
const OUT_DIR = '/root/harkat-photobooth/test-output';
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

async function verifyInteractiveStyles() {
  console.log('🚀 [Autonomous QA] Starting Interactive Style Selector Verification...');
  const results = {
    timestamp: new Date().toISOString(),
    tests: [],
    allPassed: true
  };

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--window-size=390,844'
      ]
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

    // Test 1: Load Sandbox /dev
    console.log('📌 Test 1: Load /dev...');
    await page.goto('http://127.0.0.1:8123/dev', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));

    const pageTitle = await page.title();
    const hasConsoleErrors = consoleErrors.length > 0;
    results.tests.push({
      name: 'Load /dev page',
      passed: !hasConsoleErrors && pageTitle.length > 0,
      details: hasConsoleErrors ? consoleErrors : `Title: ${pageTitle}`
    });

    // Test 2: Execute Scan Flow
    console.log('📌 Test 2: Triggering Face Scan Flow...');
    await page.click('#btnScan');
    
    // Wait for scan to finish and liveResultPanel to appear
    await page.waitForFunction(() => {
      const panel = document.querySelector('#liveResultPanel');
      return panel && panel.style.display === 'flex';
    }, { timeout: 15000 });

    const scanData = await page.evaluate(() => {
      return {
        genderAge: document.querySelector('#liveGenderAge')?.textContent?.trim(),
        beauty: document.querySelector('#liveBeauty')?.textContent?.trim(),
        lookalike: document.querySelector('#liveLookalike')?.textContent?.trim(),
        hasCertImage: !!document.querySelector('#certImg')?.src,
        styleTabsCount: document.querySelectorAll('.style-tab').length
      };
    });
    console.log('Scan Data extracted:', scanData);

    results.tests.push({
      name: 'Scan Completion & Live Result Display',
      passed: !!scanData.genderAge && scanData.styleTabsCount >= 6, // 3 in live panel + 3 in modal
      details: scanData
    });

    // Test 3: Test Style Selector Tab switching (duo -> swap -> single -> duo)
    console.log('📌 Test 3: Testing Style Tabs in Live Result Panel...');
    
    // Switch to SWAP
    await page.evaluate(() => {
      const swapBtn = document.querySelector('#liveResultPanel .style-tab[data-mode="swap"]');
      if (swapBtn) swapBtn.click();
    });
    await new Promise(r => setTimeout(r, 300));
    
    const swapDataUrl = await page.evaluate(() => document.querySelector('#certImg').src);
    const swapIsActive = await page.evaluate(() => {
      const b = document.querySelector('#liveResultPanel .style-tab[data-mode="swap"]');
      return b && b.classList.contains('active');
    });

    results.tests.push({
      name: 'Switch to Head Swap Persona (swap)',
      passed: swapIsActive && swapDataUrl.startsWith('data:image/png;base64,'),
      details: { swapIsActive, dataUrlLen: swapDataUrl.length }
    });

    // Switch to SINGLE
    await page.evaluate(() => {
      const singleBtn = document.querySelector('#liveResultPanel .style-tab[data-mode="single"]');
      if (singleBtn) singleBtn.click();
    });
    await new Promise(r => setTimeout(r, 300));

    const singleDataUrl = await page.evaluate(() => document.querySelector('#certImg').src);
    const singleIsActive = await page.evaluate(() => {
      const b = document.querySelector('#liveResultPanel .style-tab[data-mode="single"]');
      return b && b.classList.contains('active');
    });

    results.tests.push({
      name: 'Switch to Classic Portrait (single)',
      passed: singleIsActive && singleDataUrl.startsWith('data:image/png;base64,'),
      details: { singleIsActive, dataUrlLen: singleDataUrl.length }
    });

    // Switch to DUO
    await page.evaluate(() => {
      const duoBtn = document.querySelector('#liveResultPanel .style-tab[data-mode="duo"]');
      if (duoBtn) duoBtn.click();
    });
    await new Promise(r => setTimeout(r, 300));

    const duoDataUrl = await page.evaluate(() => document.querySelector('#certImg').src);
    const duoIsActive = await page.evaluate(() => {
      const b = document.querySelector('#liveResultPanel .style-tab[data-mode="duo"]');
      return b && b.classList.contains('active');
    });

    results.tests.push({
      name: 'Switch to Kembaran Biometrik (duo)',
      passed: duoIsActive && duoDataUrl.startsWith('data:image/png;base64,'),
      details: { duoIsActive, dataUrlLen: duoDataUrl.length }
    });

    // Test 4: Open Modal Preview & Test Synchronized Switching Inside Modal
    console.log('📌 Test 4: Open Modal Preview & Test Synchronized Switching...');
    await page.click('#btnLivePreview');
    await page.waitForFunction(() => document.querySelector('#modalResult').style.display === 'flex', { timeout: 5000 });

    // Click swap inside modal
    await page.evaluate(() => {
      const modalSwapBtn = document.querySelector('#modalResult .style-tab[data-mode="swap"]');
      if (modalSwapBtn) modalSwapBtn.click();
    });
    await new Promise(r => setTimeout(r, 300));

    const modalSwapActive = await page.evaluate(() => {
      const b = document.querySelector('#modalResult .style-tab[data-mode="swap"]');
      return b && b.classList.contains('active');
    });

    // Save screenshot of modal
    const modalShotPath = path.join(OUT_DIR, 'modal-interactive-style-preview.png');
    await page.screenshot({ path: modalShotPath });
    console.log(`📸 Modal Screenshot saved to ${modalShotPath}`);

    results.tests.push({
      name: 'Modal Preview & Interactive Style Tabs Sync',
      passed: modalSwapActive,
      details: { modalSwapActive, screenshot: modalShotPath }
    });

    // Test 5: Verify Download URL integrity
    const downloadHref = await page.evaluate(() => document.querySelector('#btnDownloadCert').href);
    results.tests.push({
      name: 'Download Certificate Link Ready',
      passed: downloadHref && downloadHref.startsWith('data:image/png;base64,'),
      details: { validPngDataUrl: downloadHref.length > 5000 }
    });

  } catch (err) {
    console.error('❌ Verification Exception:', err);
    results.allPassed = false;
    results.error = err.message;
  } finally {
    if (browser) await browser.close();
  }

  // Calculate overall pass status
  const failedTests = results.tests.filter(t => !t.passed);
  results.allPassed = failedTests.length === 0 && !results.error;

  console.log('\n================ VERIFICATION REPORT ================');
  results.tests.forEach(t => {
    console.log(`${t.passed ? '✅' : '❌'} [${t.name}]`);
  });
  console.log(`Overall Result: ${results.allPassed ? 'ALL TESTS PASSED ✅' : 'SOME TESTS FAILED ❌'}`);
  console.log('====================================================\n');

  if (!results.allPassed) {
    process.exit(1);
  }
}

verifyInteractiveStyles();
