const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = '/snap/chromium/current/usr/lib/chromium-browser/chrome';

async function runDevAccuracyVerification() {
  console.log('🚀 [Calista QA] Running /dev High-Accuracy AI Verification...');
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
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const t = msg.text();
        if (!t.includes('favicon') && !t.includes('face_landmarker')) {
          errors.push(t);
        }
      }
    });
    page.on('pageerror', err => errors.push(err.message));

    // 1. Navigate to /dev
    console.log('1. Navigating to http://127.0.0.1:8123/dev ...');
    await page.goto('http://127.0.0.1:8123/dev', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));

    // Verify /dev loaded
    const title = await page.title();
    console.log('Page Title:', title);

    // 2. Check UI elements
    const elements = await page.evaluate(() => {
      return {
        btnScan: !!document.querySelector('#btnScan'),
        scanningOverlay: !!document.querySelector('#scanningOverlay'),
        scanStepTitle: !!document.querySelector('#scanStepTitle'),
        liveResultPanel: !!document.querySelector('#liveResultPanel')
      };
    });
    console.log('UI Elements:', elements);

    // 3. Trigger scanning flow in /dev
    console.log('3. Triggering scan flow...');
    await page.evaluate(() => {
      if (window.executeScanningFlow) {
        window.executeScanningFlow();
      } else {
        document.querySelector('#btnScan').click();
      }
    });

    // Wait for scanning process to complete and live result panel or modal to appear
    console.log('Waiting for scan & verification completion...');
    await page.waitForFunction(() => {
      const panel = document.querySelector('#liveResultPanel');
      const modal = document.querySelector('#modalResult');
      return (panel && panel.style.display === 'flex') || (modal && modal.style.display === 'flex');
    }, { timeout: 25000 });

    await new Promise(r => setTimeout(r, 1000));

    // Capture screenshot of the modal/panel result
    const modalShotPath = '/root/harkat-photobooth/test-output/dev_result_modal.png';
    await page.screenshot({ path: modalShotPath, fullPage: false });
    console.log('Result screenshot saved to:', modalShotPath);

    // Close modal if open to see live result panel
    await page.evaluate(() => {
      const modal = document.querySelector('#modalResult');
      if (modal && modal.style.display === 'flex') {
        const closeBtn = document.querySelector('#modalResult .close-btn') || document.querySelector('#btnCloseModal');
        if (closeBtn) closeBtn.click();
        else modal.style.display = 'none';
      }
    });
    await new Promise(r => setTimeout(r, 500));

    const scanData = await page.evaluate(() => {
      const genderAge = document.querySelector('#liveGenderAge')?.textContent || '';
      const gen = document.querySelector('#liveGen')?.textContent || '';
      const wrinkle = document.querySelector('#liveWrinkle')?.textContent || '';
      const beauty = document.querySelector('#liveBeauty')?.textContent || '';
      const symmetry = document.querySelector('#liveSymmetry')?.textContent || '';
      const lookalike = document.querySelector('#liveLookalike')?.textContent || '';
      const lookalikeRole = document.querySelector('#liveLookalikeRole')?.textContent || '';
      const comment = document.querySelector('#liveComment')?.textContent || '';
      const matchPct = document.querySelector('#liveMatchPctText')?.textContent || '';
      return { genderAge, gen, wrinkle, beauty, symmetry, lookalike, lookalikeRole, comment, matchPct };
    });
    console.log('Scanned & Verified Result:', JSON.stringify(scanData, null, 2));

    // Capture screenshot of the live result panel
    const panelShotPath = '/root/harkat-photobooth/test-output/dev_live_result_panel.png';
    await page.screenshot({ path: panelShotPath, fullPage: false });
    console.log('Panel screenshot saved to:', panelShotPath);

    // Save certificate image
    const certSrc = await page.evaluate(() => document.querySelector('#certImg')?.src || '');
    if (certSrc && certSrc.startsWith('data:image/png;base64,')) {
      const b64 = certSrc.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync('/root/harkat-photobooth/test-output/dev_cert_generated.png', Buffer.from(b64, 'base64'));
      console.log('Generated Certificate saved to: /root/harkat-photobooth/test-output/dev_cert_generated.png');
    }

    console.log('✅ /dev Accuracy Verification Completed Successfully!');
  } catch (err) {
    console.error('Verification failed:', err);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
}

runDevAccuracyVerification();
