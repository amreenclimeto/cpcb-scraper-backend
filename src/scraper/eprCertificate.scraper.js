import axios from "axios";
import https from "https";
import { getPage, closeBrowser } from "../playwright/browserManager.js";

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

export const fetchEprCertificates = async () => {
  let browser;
  const startTime = Date.now();

  try {
    console.log("🚀 [SCRAPER START] EPR Certificate Scraper");

    const { browser: br, page } = await getPage();
    browser = br;

    console.log("🌐 Browser launched");

    let payload = null;

    console.log("🌍 Opening CPCB certificates page...");

    // 🔥 Capture API request payload
    page.on("request", (request) => {
      if (
        request.url().includes("list_certificates") &&
        request.method() === "POST"
      ) {
        console.log("📡 [INTERCEPT] API Request:", request.url());

        try {
          const postData = request.postData();

          if (postData) {
            payload = JSON.parse(postData);
            console.log("✅ [PAYLOAD CAPTURED]", {
              keys: Object.keys(payload),
              sample: payload,
            });
          }
        } catch (err) {
          console.log("❌ [PAYLOAD PARSE ERROR]:", err.message);
        }
      }
    });

    await page.goto(
      "https://eprplastic.cpcb.gov.in/#/plastic/home/viewCertificates",
      { waitUntil: "networkidle" }
    );

    console.log("⏳ Waiting for network/API trigger (7s)...");
    await page.waitForTimeout(7000);

    if (!payload) {
      console.log("❌ [ERROR] Payload not captured");
      throw new Error("Payload not captured from network");
    }

    console.log("📤 Calling CPCB API with captured payload...");

    const apiStart = Date.now();

    const response = await axios.post(
      "https://eprplastic.cpcb.gov.in/epr/m3/api/v1.0/pibo/list_certificates",
      payload,
      {
        httpsAgent,
        timeout: 60000,
      }
    );

    console.log(
      `✅ [API SUCCESS] Status: ${response.status} | Time: ${
        Date.now() - apiStart
      }ms`
    );

    const data = response.data?.tableData?.bodyContent || [];

    console.log(`📊 Total Records Fetched: ${data.length}`);

    const formatted = [];

    for (const [index, item] of data.entries()) {
      const obj = {
        category: item.processing_type?.trim(),
        generated: Number(item["col-3"]) || 0,
        transferred: Number(item["col-2"]) || 0,
        available: Number(item["col-1"]) || 0,
      };

      console.log(
        `🧾 [ROW ${index + 1}]`,
        `Category: ${obj.category} | Gen: ${obj.generated} | Trans: ${obj.transferred} | Avail: ${obj.available}`
      );

      formatted.push(obj);
    }

    console.log(
      `🎯 [SCRAPER SUCCESS] Processed ${formatted.length} records in ${
        Date.now() - startTime
      }ms`
    );

    return formatted;
  } catch (error) {
    console.error("❌ [SCRAPER ERROR]", {
      message: error.message,
      code: error.code,
      status: error?.response?.status,
      data: error?.response?.data,
      stack: error.stack,
    });

    throw new Error("Failed to fetch EPR certificate data");
  } finally {
    console.log("🧹 Closing browser...");
    await closeBrowser(browser);

    console.log(
      `🔚 [SCRAPER END] Total Time: ${Date.now() - startTime}ms`
    );
  }
};