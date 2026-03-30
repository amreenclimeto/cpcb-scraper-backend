import axios from "axios";
import https from "https";
import { getPage, closeBrowser } from "../playwright/browserManager.js";

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

export const fetchEprCertificates = async () => {
  let browser;

  try {
    console.log("🚀 Starting EPR scraper...");

    const { browser: br, page } = await getPage();
    browser = br;

    let payload = null;

    console.log("🌐 Opening CPCB page...");

    // 🔥 Capture API request payload
    page.on("request", (request) => {
      if (
        request.url().includes("list_certificates") &&
        request.method() === "POST"
      ) {
        console.log("📡 API Request intercepted:", request.url());

        try {
          const postData = request.postData();
          if (postData) {
            payload = JSON.parse(postData);
            console.log("✅ Payload captured:", payload);
          }
        } catch (err) {
          console.log("❌ Payload parse error:", err.message);
        }
      }
    });

    await page.goto(
      "https://eprplastic.cpcb.gov.in/#/plastic/home/viewCertificates",
      { waitUntil: "networkidle" },
    );

    console.log("⏳ Waiting for API trigger...");
    await page.waitForTimeout(7000);

    if (!payload) {
      console.log("❌ Payload not found after page load");
      throw new Error("Payload not captured from network");
    }

    console.log("📤 Calling API with payload...");

    const response = await axios.post(
      "https://eprplastic.cpcb.gov.in/epr/m3/api/v1.0/pibo/list_certificates",
      payload,
      {
        httpsAgent,
        timeout: 60000, // ⏱️ increased timeout
      },
    );

    console.log("✅ API Response received");

    const data = response.data?.tableData?.bodyContent || [];

    console.log("📊 Records fetched:", data.length);

    const formatted = [];

    for (const item of data) {
      const obj = {
        category: item.processing_type?.trim(),
        generated: Number(item["col-3"]) || 0,
        transferred: Number(item["col-2"]) || 0,
        available: Number(item["col-1"]) || 0,
      };

      console.log("🧾 Row:", obj);

      formatted.push(obj);
    }

    return formatted;
  } catch (error) {
    console.error("❌ EPR Scraper Error FULL:", {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });

    throw new Error("Failed to fetch EPR certificate data");
  } finally {
    console.log("🧹 Closing browser...");
    await closeBrowser(browser);
  }
};
