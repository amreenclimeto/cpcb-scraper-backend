import { getPage, closeBrowser } from "../playwright/browserManager.js";
/**
 * Fetch EPR National Dashboard data
 * @param {Object} options - Scraping options
 * @param {boolean} options.headless - Run in headless mode (default: false)
 * @returns {Promise<Object>} Scraping result with rows
 */
async function fetchNationalDashboard() {
  let browser;
  const ROWS = new Map();
  let TOTAL = 0;
  let page = null;

  try {
    // ✅ Get page with headless option
    const result = await getPage();
    browser = result.browser;
    page = result.page;
    // 🔥 API Response Listener (captures data automatically in background)
    page.on("response", async (res) => {
      try {
        if (
          res.url().includes("national_dashboard_application_table") &&
          res.request().method() === "POST" &&
          res.status() === 200
        ) {
          const json = await res.json();

          if (!TOTAL && json?.data?.all_application?.total_no) {
            TOTAL = json.data.all_application.total_no;
            console.log("📊 TOTAL:", TOTAL);
          }

          const data =
            json?.data?.all_application?.tableData?.bodyContent || [];

          for (const row of data) {
            if (row.reg_id && !ROWS.has(row.reg_id)) {
              ROWS.set(row.reg_id, {
                created_on: row.created_on,
                company_legal_name: row.company_legal_name,
                company_trade_name: row.company_trade_name,
                application_id: row.application_id,
                reg_id: row.reg_id,
                applicant_type: row.applicant_type,
                status: row.status,
              });
            }
          }

          console.log(`⚡ Collected: ${ROWS.size}/${TOTAL}`);
        }
      } catch (e) {
        // Silent fail
      }
    });

    // 1️⃣ Open dashboard
    // 1️⃣ Open dashboard with retry and maintenance handling
    const DASHBOARD_URL =
      "https://eprplastic.cpcb.gov.in/#/plastic/home/main_dashboard";

    let loaded = false;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`🌐 Loading dashboard (attempt ${attempt})`);

        await page.goto(DASHBOARD_URL, {
          waitUntil: "networkidle",
          timeout: 60000,
        });

        // Small wait to let page settle
        await page.waitForTimeout(5000);

        // 🔍 Maintenance / Down detection
        const content = await page.content();

        if (
          content.includes("Maintenance") ||
          content.includes("temporarily unavailable") ||
          content.includes("Site is under maintenance") ||
          content.includes("Service Unavailable") ||
          content.includes("502 Bad Gateway") ||
          content.includes("504 Gateway Time-out")
        ) {
          throw new Error("CPCB portal is under maintenance or down");
        }

        loaded = true;
        break;
      } catch (err) {
        console.log(`⚠️ Attempt ${attempt} failed:`, err.message);

        if (attempt === 3) {
          throw new Error("Dashboard failed after 3 attempts: " + err.message);
        }

        await page.waitForTimeout(5000);
      }
    }

    if (!loaded) {
      throw new Error("Dashboard could not be loaded");
    }

    // 2️⃣ Switch Graph → Table
    const tableBtn = page.locator(
      '.btn-group.btn-toggle-group button:has-text("Table")',
    );
    await tableBtn.waitFor({ state: "visible", timeout: 30000 });
    await tableBtn.click({ force: true });
    await page.waitForTimeout(1500);

    console.log("🔄 Switched to Table view");

    // 3️⃣ Set Show = 100
    try {
      const showSelect = page.locator("ng-select.w-100px").first();
      await showSelect.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await showSelect.click({ force: true });
      await page.waitForTimeout(1000);

      const option100 = page.locator(
        '.ng-dropdown-panel .ng-option:has-text("100")',
      );
      await option100.waitFor({ state: "visible", timeout: 15000 });
      await option100.click({ force: true });

      console.log("✅ Set to 100 rows per page");
      await page.waitForTimeout(2000);
    } catch (err) {
      console.log("⚠️ Could not set to 100 rows, continuing with 10");
    }

    console.log("🚀 Fast API-based scraping started");

    // 4️⃣ Fast pagination loop
    let noNewDataCount = 0;
    const MAX_NO_DATA = 5;

    while (true) {
      // Priority check: if we have all data, stop
      if (TOTAL > 0 && ROWS.size >= TOTAL) {
        console.log("✅ All data collected");
        break;
      }

      const nextBtn = page
        .locator("td.last-row button", { hasText: "Next" })
        .first();

      const btnCount = await nextBtn.count();
      if (btnCount === 0) {
        console.log("🛑 Next button not found");
        break;
      }

      const sizeBefore = ROWS.size;

      try {
        await nextBtn.scrollIntoViewIfNeeded();

        await Promise.all([
          page.waitForResponse(
            (res) =>
              res.url().includes("national_dashboard_application_table") &&
              res.request().method() === "POST" &&
              res.status() === 200,
            { timeout: 12000 },
          ),
          nextBtn.click({ force: true }),
        ]);

        // Wait for API listener to process
        await page.waitForTimeout(500);

        const sizeAfter = ROWS.size;

        // Check if we got new data
        if (sizeAfter > sizeBefore) {
          // Success! Reset counter
          noNewDataCount = 0;
        } else {
          // No new data
          noNewDataCount++;
          console.log(`⚠️ No new data (${noNewDataCount}/${MAX_NO_DATA})`);

          if (noNewDataCount >= MAX_NO_DATA) {
            console.log("🛑 No new data after 5 consecutive attempts");
            break;
          }

          // Wait longer before retry
          await page.waitForTimeout(1500);
        }
      } catch (err) {
        // Click or API failed
        noNewDataCount++;
        console.log(
          `⚠️ Error (${noNewDataCount}/${MAX_NO_DATA}):`,
          err.message,
        );

        if (noNewDataCount >= MAX_NO_DATA) {
          console.log("🛑 Too many consecutive errors");
          break;
        }

        await page.waitForTimeout(1500);
      }
    }

    console.log("🎉 SCRAPING COMPLETE:", ROWS.size);

    return {
      success: true,
      total: ROWS.size,
      rows: [...ROWS.values()],
    };
  } catch (err) {
    console.error("❌ EPR dashboard fetch error:", err);

    return {
      success: false,
      total: ROWS.size,
      rows: [...ROWS.values()],
      error: err.message,
    };
  } finally {
    await closeBrowser(browser);
  }
}

export default fetchNationalDashboard;
