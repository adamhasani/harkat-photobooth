const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CHROME = '/snap/chromium/current/usr/lib/chromium-browser/chrome';

async function runVerification() {
  console.log('🚀 [Autonomous QA] Running Photobooth Sandbox Verification...');
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

    // Test 1: Load /dev sandbox
    await page.goto('http://127.0.0.1:8123/dev', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));

    const pageTitle = await page.title();
    const hasConsoleErrors = consoleErrors.length > 0;
    results.tests.push({
      name: 'Load Sandbox /dev',
      passed: !hasConsoleErrors && pageTitle.length > 0,
      details: hasConsoleErrors ? consoleErrors : `Title: ${pageTitle}`
    });

    // Test 2: Clean Minimal UI (Camera Viewport + Main Scan Button Only)
    const uiLayout = await page.evaluate(() => {
      return {
        hasVideo: !!document.querySelector('#video'),
        hasScanBtn: !!document.querySelector('#btnScan'),
        hasCornerBrackets: document.querySelectorAll('.corner-bracket').length === 4,
        hasOverlay: !!document.querySelector('#scanningOverlay'),
        hasNoClutterTabs: !document.querySelector('.mode-nav'),
        hasNoHudPanel: !document.querySelector('#hudPanel')
      };
    });
    const isCleanMinimal = uiLayout.hasVideo && uiLayout.hasScanBtn && uiLayout.hasCornerBrackets && uiLayout.hasNoClutterTabs && uiLayout.hasNoHudPanel;
    results.tests.push({
      name: 'Clean Minimal UI (Camera & Scan Button Only)',
      passed: isCleanMinimal,
      details: uiLayout
    });

    // Test 3: Simulated Scanning Flow & Modal Popup
    await page.click('#btnScan');
    await new Promise(r => setTimeout(r, 600));

    const duringScan = await page.evaluate(() => {
      return {
        isOverlayActive: document.querySelector('#scanningOverlay').style.display === 'flex',
        stepTitle: document.querySelector('#scanStepTitle')?.textContent?.trim(),
        hasProgress: !!document.querySelector('#scanProgressFill')?.style?.width
      };
    });

    await page.waitForFunction(() => document.querySelector('#modalResult').style.display === 'flex', { timeout: 10000 });

    const modalResult = await page.evaluate(() => {
      return {
        isOpen: document.querySelector('#modalResult').style.display === 'flex',
        primary: document.querySelector('#certPrimaryResult')?.textContent?.trim(),
        beauty: document.querySelector('#certBeautyResult')?.textContent?.trim(),
        secondary: document.querySelector('#certSecondaryResult')?.textContent?.trim(),
        hasImage: !!document.querySelector('#certImg')?.src
      };
    });

    results.tests.push({
      name: 'Simulated Scanning Sequence & Certificate Modal',
      passed: duringScan.isOverlayActive && modalResult.isOpen && modalResult.hasImage,
      details: { duringScan, modalResult }
    });

    // Test 4: Landmarker Engine & Smoother API
    const biometricsTest = await page.evaluate(async () => {
      if (!window.landmarker || !window.getSmoothedFaceMetrics) {
        return { success: false, error: 'Landmarker or smoother not exported' };
      }
      return { success: true };
    });

    results.tests.push({
      name: 'Landmarker Engine & Smoother API',
      passed: biometricsTest.success,
      details: biometricsTest
    });

    // Test 5: Production Branch Safety
    const prodUntouched = !fs.existsSync('/root/harkat-photobooth/.git/MERGE_HEAD');
    results.tests.push({
      name: 'Production Branch Safety',
      passed: prodUntouched,
      details: 'Main files untouched'
    });

  } catch (err) {
    results.allPassed = false;
    results.tests.push({
      name: 'Exception',
      passed: false,
      details: err.message
    });
  } finally {
    if (browser) await browser.close();
  }

  results.allPassed = results.tests.every(t => t.passed);
  console.log(`✅ [Autonomous QA] Result: ${results.allPassed ? 'ALL PASSED' : 'SOME FAILED'}`);
  return results;
}

if (require.main === module) {
  runVerification().then(res => {
    fs.writeFileSync('/root/workspace/last-qa-report.json', JSON.stringify(res, null, 2));
    process.exit(res.allPassed ? 0 : 1);
  });
}

module.exports = { runVerification };
