import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.error('PAGE ERROR!', error.message));
  page.on('requestfailed', request => console.error('REQUEST FAILED:', request.url(), request.failure().errorText));

  try {
    await page.goto('http://localhost:4325/', { waitUntil: 'networkidle2' });
    console.log('Page loaded');
    const buttons = await page.$$('button');
    let fullCalBtn = null;
    for (const btn of buttons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text.includes('Полный календарь')) {
        fullCalBtn = btn;
        break;
      }
    }
    if (fullCalBtn) {
      console.log('Clicking Full Calendar...');
      await fullCalBtn.click();
      await page.waitForTimeout(2000);
      console.log('Finished waiting');
    } else {
      console.log('Full Calendar button not found');
    }
  } catch (err) {
    console.error('SCRIPT ERROR:', err);
  } finally {
    await browser.close();
  }
})();
