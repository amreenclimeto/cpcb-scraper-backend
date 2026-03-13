import { chromium } from "playwright";

export default async function batteryProdMetalWiseDashboardLinks() {

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

  // Extract all 10 metal button links
  const metalLinks = await page.evaluate(() => {
    const anchors = document.querySelectorAll("a[href*='producerTargetCredit']:has(button)");
    return Array.from(anchors).map(a => ({
      metal: a.querySelector("button")?.innerText?.trim()?.toLowerCase(),
      href: a.getAttribute("href")
    }));
  });

  await browser.close();

  console.log("Metal links found:", metalLinks.map(m => m.metal));

  if (!metalLinks.length) throw new Error("No metal links found on dashboard");

  return metalLinks; // [{ metal: "lead", href: "https://..." }, ...]

}