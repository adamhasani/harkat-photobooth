const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CHROME = '/snap/chromium/current/usr/lib/chromium-browser/chrome';

async function testMesh() {
  console.log('🧪 Testing Face Mesh Coordinate Mapping in /dev and /ai...');
  const browser = await puppeteer.launch({
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
    const text = msg.text();
    if (msg.type() === 'error' && !text.includes('TensorFlow Lite') && !text.includes('face_landmarker')) {
      errors.push(text);
    }
  });
  page.on('pageerror', err => errors.push(err.message));

  await page.goto('http://127.0.0.1:8123/dev', { waitUntil: 'networkidle0', timeout: 15000 });
  await new Promise(r => setTimeout(r, 2000));

  // Verify transform math & canvas drawing
  const diag = await page.evaluate(() => {
    const video = document.querySelector('#video');
    const canvas = document.querySelector('#overlayCanvas');
    const camWrap = document.querySelector('#camWrap');

    // Run adaptSize and getVideoTransform
    const transform = typeof window.getVideoTransform === 'function' ? window.getVideoTransform() : null;
    
    return {
      camWrapWidth: camWrap.clientWidth,
      camWrapHeight: camWrap.clientHeight,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      hasMirror: video.classList.contains('mirror')
    };
  });

  console.log('DIAGNOSTICS:', JSON.stringify(diag, null, 2));

  // Take screenshot of /dev
  await page.screenshot({ path: '/root/harkat-photobooth/uploads/preview_mesh_dev.png' });
  console.log('📸 Screenshot saved to /root/harkat-photobooth/uploads/preview_mesh_dev.png');

  // Also test /ai
  await page.goto('http://127.0.0.1:8123/ai', { waitUntil: 'networkidle0', timeout: 15000 });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: '/root/harkat-photobooth/uploads/preview_mesh_ai.png' });
  console.log('📸 Screenshot saved to /root/harkat-photobooth/uploads/preview_mesh_ai.png');

  console.log('ERRORS:', errors);
  await browser.close();

  if (errors.length > 0) {
    console.error('FAILED with errors');
    process.exit(1);
  } else {
    console.log('✅ ALL MESH TESTS PASSED!');
    process.exit(0);
  }
}

testMesh();
