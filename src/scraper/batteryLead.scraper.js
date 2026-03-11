import { chromium } from "playwright";

export default async function scrapeBatteryLead() {

  const browser = await chromium.launch({
    headless: false,
    ignoreHTTPSErrors: true
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true
  });

  const page = await context.newPage();

  await page.goto("https://eprbattery.cpcb.gov.in/user/nationaldashboard", {
    waitUntil: "networkidle"
  });

  const leadLink = await page
    .locator("a[href*='producerTargetCredit']:has(button)")
    .first()
    .getAttribute("href");

  if (!leadLink) throw new Error("Lead link not found");

  let apiUrl = null;

  page.on("request", request => {
    const url = request.url();
    if (url.includes("producerTargetCredit") && url.includes("length=")) {
      apiUrl = url;
    }
  });

  await page.goto(leadLink, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  if (!apiUrl) throw new Error("API URL not detected");

  apiUrl = apiUrl
    .replace(/length=\d+/, "length=-1")
    .replace(/start=\d+/, "start=0");

  console.log("Fetching URL:", apiUrl);

  const response = await context.request.get(apiUrl, {
    headers: {
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",        // ✅ Marks it as AJAX request
      "Referer": leadLink                           // ✅ Tells server where request came from
    }
  });

  console.log("Response status:", response.status());
  console.log("Response headers:", response.headers());

  const text = await response.text();
  console.log("Raw response (first 500):", text.slice(0, 500));

  // ✅ Check if HTML before parsing
  if (text.trim().startsWith("<")) {
    throw new Error(`Server returned HTML instead of JSON. Status: ${response.status()}`);
  }

  const data = JSON.parse(text);

  await browser.close();

  console.log("recordsTotal:", data.recordsTotal);
  console.log("rows received:", data.data?.length);

  if (!Array.isArray(data.data)) {
    throw new Error(`data.data is not an array: ${JSON.stringify(data).slice(0, 300)}`);
  }

  return data.data;

}