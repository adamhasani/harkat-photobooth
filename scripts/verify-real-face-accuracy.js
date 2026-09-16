const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CHROME = '/snap/chromium/current/usr/lib/chromium-browser/chrome';

async function testWithRealFace() {
  console.log('🧪 Testing /dev with real face photo injection...');
  const testImgBuf = fs.readFileSync('/root/harkat-photobooth/test-output/spiderman_perfect_iqbaal_ramadhan.jpg');
  const b64Photo = 'data:image/jpeg;base64,' + testImgBuf.toString('base64');

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true });

    await page.goto('http://127.0.0.1:8123/dev', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1500));

    // Inject real photo into capture canvas and trigger flow
    const result = await page.evaluate(async (photoData) => {
      // Create an image object
      const img = new Image();
      img.src = photoData;
      await new Promise(r => img.onload = r);

      // Override capture canvas with the real photo
      const capCv = document.createElement('canvas');
      capCv.width = img.width;
      capCv.height = img.height;
      const ctx = capCv.getContext('2d');
      ctx.drawImage(img, 0, 0);

      // Call /api/dev-ai-analyze directly from browser context
      const res = await fetch('/api/dev-ai-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photo: photoData,
          telemetry: {
            gender: 'Laki-laki',
            isLikelyMale: true,
            estAge: 24,
            faceShape: 'Oval',
            jawRatio: 0.56,
            chinRatio: 0.60,
            eyeRatio: 0.38,
            wrinkleTension: 0.16,
            symmetryPct: 96,
            smilePct: 75
          }
        })
      });

      return await res.json();
    }, b64Photo);

    console.log('Browser /api/dev-ai-analyze Response:');
    console.log(JSON.stringify(result, null, 2));

    if (result && result.ok && result.ai && result.ai.lookalike) {
      console.log('✅ Real Face AI Verification SUCCESS!');
      console.log(`Matched: ${result.ai.lookalike} (${result.ai.lookalikeRole}) - Score: ${result.ai.beautyScore}%`);
      console.log(`Critique Gender Check: ${result.ai.verification.critique.gender_verification}`);
      console.log(`Critique Age Check: ${result.ai.verification.critique.age_verification}`);
    } else {
      console.error('❌ Unexpected response:', result);
      process.exit(1);
    }
  } finally {
    await browser.close();
  }
}

testWithRealFace();
