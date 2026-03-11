import { chromium } from "playwright";

export async function getPage() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      "--single-process"
    ]
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true
  });

  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  return { browser, context, page };
}

export async function closeBrowser(browser) {
  if (browser) {
    try {
      await browser.close();
    } catch {}
  }
}
