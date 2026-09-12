const puppeteer = require('puppeteer-core');

const CHROME = '/snap/chromium/current/usr/lib/chromium-browser/chrome';

async function verifyTransformMath() {
  console.log('📐 Verifying Mathematical Precision of Coordinate Mapping...');
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

  await page.goto('http://127.0.0.1:8123/dev', { waitUntil: 'networkidle0', timeout: 15000 });
  await new Promise(r => setTimeout(r, 2000));

  const testResults = await page.evaluate(() => {
    // Mock landmarks array with 468 points
    const mockLandmarks = [];
    for (let i = 0; i < 468; i++) {
      // Put a mock face centered at x=0.5, y=0.45, radius 0.2
      mockLandmarks.push({ x: 0.5, y: 0.45, z: 0 });
    }
    // Set specific keypoints
    mockLandmarks[1] = { x: 0.5, y: 0.45 }; // Nose tip
    mockLandmarks[10] = { x: 0.5, y: 0.25 }; // Forehead
    mockLandmarks[152] = { x: 0.5, y: 0.65 }; // Chin
    mockLandmarks[33] = { x: 0.4, y: 0.38 }; // Left eye
    mockLandmarks[263] = { x: 0.6, y: 0.38 }; // Right eye
    mockLandmarks[61] = { x: 0.45, y: 0.55 }; // Mouth left
    mockLandmarks[291] = { x: 0.55, y: 0.55 }; // Mouth right

    const video = document.querySelector('#video');
    const camWrap = document.querySelector('#camWrap');
    
    // Simulate setting lastFaces
    window.lastFaces = [mockLandmarks];
    window.lastBs = [{ categories: [] }];

    // Trigger renderOverlay
    if (typeof window.renderOverlay === 'function') {
      window.renderOverlay();
    }

    const t = window.getVideoTransform ? window.getVideoTransform() : null;
    const mappedNose = window.mapNormalizedToCanvas ? window.mapNormalizedToCanvas(mockLandmarks[1], t, true) : null;
    const mappedLeftEye = window.mapNormalizedToCanvas ? window.mapNormalizedToCanvas(mockLandmarks[33], t, true) : null;
    const mappedRightEye = window.mapNormalizedToCanvas ? window.mapNormalizedToCanvas(mockLandmarks[263], t, true) : null;

    return {
      t,
      mappedNose,
      mappedLeftEye,
      mappedRightEye,
      isNoseCenteredX: Math.abs(mappedNose.x - (camWrap.clientWidth / 2)) < 1.0
    };
  });

  console.log('TRANSFORM_TEST_RESULT:', JSON.stringify(testResults, null, 2));

  await page.screenshot({ path: '/root/harkat-photobooth/uploads/preview_mock_face_mesh.png' });
  console.log('📸 Mock face overlay screenshot saved to /root/harkat-photobooth/uploads/preview_mock_face_mesh.png');

  await browser.close();
}

verifyTransformMath();
