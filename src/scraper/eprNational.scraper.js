import { getPage, closeBrowser } from "../playwright/browserManager.js";
import { getTotalCount } from "../services/eprNational.service.js";

async function fetchNationalDashboard() {
  let browser;
  const ROWS = new Map();
  let TOTAL = 0;
  let page = null;
  let dbCount = 0;
  let isSkipping = true; // 🆕 skip phase flag

  try {
    dbCount = await getTotalCount();
    console.log("📦 DB count:", dbCount);

    const result = await getPage();
    browser = result.browser;
    page = result.page;

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
            console.log("📊 TOTAL on CPCB:", TOTAL);
            console.log("🆕 New records expected:", TOTAL - dbCount);
          }

          // 🆕 Skip phase mein collect mat karo
          if (isSkipping) return;

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

          console.log(`⚡ Collected: ${ROWS.size}`);
        }
      } catch (e) {}
    });

    // 1️⃣ Dashboard load
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
        await page.waitForTimeout(5000);

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

    if (!loaded) throw new Error("Dashboard could not be loaded");

    // 2️⃣ Switch to Table
    const tableBtn = page.locator(
      '.btn-group.btn-toggle-group button:has-text("Table")',
    );
    await tableBtn.waitFor({ state: "visible", timeout: 30000 });
    await tableBtn.click({ force: true });
    await page.waitForTimeout(1500);
    console.log("🔄 Switched to Table view");

    // 3️⃣ Set 100 rows
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

    // 4️⃣ Fresh DB → pura scrape
    if (dbCount === 0) {
      console.log("🚀 Fresh scrape — collecting all records");
      isSkipping = false; // seedha collect karo
      await scrapeAllPages(page, ROWS, TOTAL);
    } else {
      // 5️⃣ Skip to last pages
      const skipToPage = Math.floor(dbCount / 100);
      console.log(`⏩ Skipping to page ${skipToPage}...`);

      let currentPage = 1;

      while (currentPage < skipToPage) {
        const nextBtn = page
          .locator("td.last-row button", { hasText: "Next" })
          .first();

        if ((await nextBtn.count()) === 0) break;

        try {
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

          currentPage++;

          if (currentPage % 100 === 0) {
            console.log(`⏩ Skipped ${currentPage}/${skipToPage} pages`);
          }

          await page.waitForTimeout(150); // fast skip
        } catch (err) {
          console.log(`⚠️ Skip error at page ${currentPage}:`, err.message);
          break;
        }
      }

      // 🆕 Skip complete — ab collect karo
      isSkipping = false;
      console.log(`✅ Skip complete at page ${currentPage}, collecting new records now...`);

      await scrapeAllPages(page, ROWS, TOTAL);
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

async function scrapeAllPages(page, ROWS, TOTAL) {
  let noNewDataCount = 0;
  const MAX_NO_DATA = 5;

  while (true) {
    if (TOTAL > 0 && ROWS.size >= TOTAL) {
      console.log("✅ All data collected");
      break;
    }

    const nextBtn = page
      .locator("td.last-row button", { hasText: "Next" })
      .first();

    if ((await nextBtn.count()) === 0) {
      console.log("🛑 Last page reached");
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

      await page.waitForTimeout(500);

      if (ROWS.size > sizeBefore) {
        noNewDataCount = 0;
      } else {
        noNewDataCount++;
        console.log(`⚠️ No new data (${noNewDataCount}/${MAX_NO_DATA})`);
        if (noNewDataCount >= MAX_NO_DATA) {
          console.log("🛑 No more new records");
          break;
        }
        await page.waitForTimeout(1500);
      }
    } catch (err) {
      noNewDataCount++;
      if (noNewDataCount >= MAX_NO_DATA) break;
      await page.waitForTimeout(1500);
    }
  }
}

export default fetchNationalDashboard;
