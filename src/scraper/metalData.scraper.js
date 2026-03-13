import { chromium } from "playwright";

const RETRY_LIMIT = 3;
export const DELAY_BETWEEN_METALS = 5000;

export async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default async function scrapeMetalData(metalHref, metalName, attempt = 1) {

  try {

    const browser = await chromium.launch({
      headless: true,
      ignoreHTTPSErrors: true
    });

    const context = await browser.newContext({
      ignoreHTTPSErrors: true
    });

    const page = await context.newPage();

    let apiUrl = null;

    page.on("request", request => {
      const url = request.url();
      if (url.includes("producerTargetCredit") && url.includes("length=")) {
        apiUrl = url;
      }
    });

    await page.goto(metalHref, { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);

    if (!apiUrl) throw new Error(`API URL not detected for metal: ${metalName}`);

    apiUrl = apiUrl
      .replace(/length=\d+/, "length=-1")
      .replace(/start=\d+/, "start=0");

    console.log(`[${metalName}] Fetching all producers... (attempt ${attempt})`);

    const response = await context.request.get(apiUrl, {
      headers: {
        "Accept":           "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        "Referer":          metalHref
      },
      timeout: 60000  // ✅ 60s timeout
    });

    const text = await response.text();

    if (text.trim().startsWith("<")) {
      throw new Error(`[${metalName}] Server returned HTML instead of JSON`);
    }

    const data = JSON.parse(text);

    await browser.close();

    if (!Array.isArray(data.data)) {
      throw new Error(`[${metalName}] data.data is not an array`);
    }

    console.log(`[${metalName}] Total producers: ${data.data.length}`);

    return data.data;

  } catch (err) {

    // ✅ Retry on timeout/network error
    if (attempt < RETRY_LIMIT) {
      const waitTime = attempt * 10000; // 10s → 20s
      console.log(`[${metalName}] Failed (attempt ${attempt}), retrying in ${waitTime / 1000}s...`);
      console.log(`[${metalName}] Error: ${err.message}`);
      await sleep(waitTime);
      return scrapeMetalData(metalHref, metalName, attempt + 1);
    }

    throw err;

  }

}